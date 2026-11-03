"""Study hub: a student adds material (pasted text or an uploaded file) and studies from it.

From one piece of material the student gets notes, a multiple-choice quiz, flashcards and short-answer
questions, and every quiz or short-answer round is saved so they can see progress.

  * Only the text of an uploaded file is kept, not the file. PDF, Word, PowerPoint, text and images are read.
  * Everything belongs to its owner. Other people get NOT_FOUND, never FORBIDDEN, so ids don't leak.
  * Quizzes are marked on the server: questions are sent without answers, and the score is worked out here.
  * Content comes from Gemini's free API when GEMINI_API_KEY is set, otherwise (or if it fails) from the
    built-in basic generator. See study_ai.py.

Register in api.py: study.type_defs, study.query, study.mutation.
Needs: pip install pypdf python-docx python-pptx
"""
import base64
import binascii
import io
import logging
import re
import zipfile
from datetime import datetime, timezone

from ariadne import MutationType, QueryType
from graphql import GraphQLError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import study_ai as ai
from app.database import SessionLocal
from app.files import MAX_BYTES, MAX_MB, FileProblem, check_upload
from app.models import Course, User
from app.schema import current_user
from app.study_models import StudyAttempt, StudyCard, StudyMaterial, StudyQuestion

log = logging.getLogger("studysync.study")
MAX_MATERIALS = 50
MAX_CHARS = 80_000
MIN_CHARS = 120
MAX_ANSWER = 2000
STUDY_EXT = {"pdf", "docx", "pptx", "txt", "md", "png", "jpg", "jpeg"}
MAX_UNZIPPED = 60 * 1024 * 1024     # a .docx/.pptx is a zip: refuse ones that swell far past the upload cap


class StudyError(Exception):
    def __init__(self, field: str | None, code: str, message: str):
        super().__init__(message)
        self.field, self.code, self.message = field, code, message


# =============================== reading files ===============================

def _zip_safe(data: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if sum(i.file_size for i in z.infolist()) > MAX_UNZIPPED:
                raise StudyError("file", "TOO_LARGE", "That file is too large once opened.")
    except zipfile.BadZipFile:
        raise StudyError("file", "UNREADABLE", "That file couldn't be read.")


def _pdf(data: bytes) -> str:
    from pypdf import PdfReader
    try:
        r = PdfReader(io.BytesIO(data))
        if r.is_encrypted:
            raise StudyError("file", "UNREADABLE", "That PDF is password protected.")
        return "\n".join((p.extract_text() or "") for p in r.pages[:150])
    except StudyError:
        raise
    except Exception:
        raise StudyError("file", "UNREADABLE", "That PDF couldn't be read.")


def _docx(data: bytes) -> str:
    _zip_safe(data)
    import docx
    try:
        d = docx.Document(io.BytesIO(data))
    except Exception:
        raise StudyError("file", "UNREADABLE", "That Word file couldn't be read.")
    lines = [p.text for p in d.paragraphs]
    for t in d.tables:
        for row in t.rows:
            lines.append(" | ".join(c.text for c in row.cells))
    return "\n".join(lines)


def _pptx(data: bytes) -> str:
    _zip_safe(data)
    from pptx import Presentation
    try:
        prs = Presentation(io.BytesIO(data))
    except Exception:
        raise StudyError("file", "UNREADABLE", "That PowerPoint file couldn't be read.")
    out = []
    for n, slide in enumerate(prs.slides, 1):
        out.append(f"Slide {n}")
        for shape in slide.shapes:
            if shape.has_text_frame:
                out.append(shape.text_frame.text)
        if slide.has_notes_slide:
            out.append(slide.notes_slide.notes_text_frame.text)
    return "\n".join(out)


def read_file(name: str, data: bytes) -> tuple[str, str]:
    """(clean file name, text). Raises StudyError, or FileProblem for a bad upload."""
    name, mime = check_upload(name, data)
    ext = name.rsplit(".", 1)[-1].lower()
    if ext not in STUDY_EXT:
        raise StudyError("file", "TYPE", "Use a PDF, Word, PowerPoint, text file or an image.")
    if ext in ("txt", "md"):
        text = data.decode("utf-8")
    elif ext == "pdf":
        text = _pdf(data)
        if len(text.strip()) < MIN_CHARS and ai.enabled():       # probably scanned: let Gemini read the pages
            text = _vision(data, mime)
    elif ext == "docx":
        text = _docx(data)
    elif ext == "pptx":
        text = _pptx(data)
    else:                                                       # png / jpg
        text = _vision(data, mime)
    return name, text


def _vision(data: bytes, mime: str) -> str:
    if not ai.enabled():
        raise StudyError("file", "NEEDS_AI", "Reading text from images needs the AI key to be set up on the server. Paste the text instead.")
    try:
        return ai.transcribe(data, mime)
    except ai.AiError as e:
        raise StudyError("file", e.code, e.message)


def _decode(content: str) -> bytes:
    content = (content or "").split(",", 1)[-1] if (content or "").startswith("data:") else (content or "")
    if len(content) > MAX_BYTES * 4 // 3 + 16:
        raise StudyError("file", "TOO_LARGE", f"Files can be up to {MAX_MB} MB.")
    try:
        return base64.b64decode(content, validate=True)
    except (binascii.Error, ValueError):
        raise StudyError("file", "INVALID", "The file wasn't sent properly. Try again.")


# =============================== service ===============================

_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean_text(text: str) -> str:
    """PDFs sometimes yield broken characters (lone surrogates, control codes) that the database refuses."""
    return _CTRL.sub(" ", (text or "").encode("utf-8", "replace").decode("utf-8"))


def _id(value, what: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        raise StudyError(None, "NOT_FOUND", f"{what} not found.")


def _mine(db: Session, user: User, material_id) -> StudyMaterial:
    m = db.scalar(select(StudyMaterial).where(StudyMaterial.id == _id(material_id, "Material"),
                                              StudyMaterial.owner_id == user.id))
    if m is None:
        raise StudyError(None, "NOT_FOUND", "Material not found.")
    return m


def _pct(score: int, total: int) -> int:
    return round(100 * score / total) if total else 0


def _view(db: Session, m: StudyMaterial) -> dict:
    count = lambda model, *cond: db.scalar(select(func.count()).select_from(model).where(model.material_id == m.id, *cond)) or 0
    attempts = list(db.execute(select(StudyAttempt.score, StudyAttempt.total).where(StudyAttempt.material_id == m.id)))
    notes = m.notes or None
    return {
        "id": m.id, "title": m.title, "course": db.get(Course, m.course_id) if m.course_id else None,
        "source_kind": m.source_kind, "file_name": m.file_name, "char_count": len(m.content),
        "excerpt": m.content[:400], "generated_by": m.generated_by,
        "generated_at": m.generated_at.isoformat() if m.generated_at else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "question_count": count(StudyQuestion, StudyQuestion.kind == "mcq"),
        "short_count": count(StudyQuestion, StudyQuestion.kind == "short"),
        "card_count": count(StudyCard), "attempts": len(attempts),
        "best_percent": max((_pct(s, t) for s, t in attempts), default=None),
        "notes": ({"summary": notes.get("summary", ""), "points": notes.get("points", []), "terms": notes.get("terms", [])}
                  if notes else None),
    }


def list_materials(db: Session, user: User) -> list[dict]:
    rows = db.scalars(select(StudyMaterial).where(StudyMaterial.owner_id == user.id)
                      .order_by(StudyMaterial.created_at.desc(), StudyMaterial.id.desc()))
    return [_view(db, m) for m in rows]


def create_material(db: Session, user: User, data: dict) -> dict:
    if db.scalar(select(func.count()).select_from(StudyMaterial).where(StudyMaterial.owner_id == user.id)) >= MAX_MATERIALS:
        raise StudyError(None, "LIMIT", f"You can keep up to {MAX_MATERIALS} materials. Delete one to add another.")
    title = clean_text(data.get("title") or "").strip()
    if len(title) > 150:
        raise StudyError("title", "TOO_LONG", "Keep the title under 150 characters.")
    pasted = clean_text(data.get("text") or "").strip()
    file_name, text, kind = None, pasted, "text"
    if data.get("file_content"):
        if pasted:
            raise StudyError(None, "INVALID", "Either paste text or upload a file, not both.")
        try:
            file_name, text = read_file(data.get("file_name") or "", _decode(data["file_content"]))
        except FileProblem as e:
            raise StudyError("file", e.code, e.message)
        kind = "file"
    text = clean_text(text).strip()
    if len(text) < MIN_CHARS:
        raise StudyError("text" if kind == "text" else "file", "TOO_SHORT",
                         "There isn't enough text to study from. Add at least a few sentences.")
    text = text[:MAX_CHARS]
    course_id = None
    if data.get("course_id") is not None:
        c = db.scalar(select(Course).where(Course.id == _id(data["course_id"], "Course"), Course.owner_id == user.id))
        if c is None:
            raise StudyError("courseId", "NOT_FOUND", "Course not found.")
        course_id = c.id
    if not title:
        title = (file_name.rsplit(".", 1)[0] if file_name else text.splitlines()[0])[:80] or "Untitled material"
    m = StudyMaterial(owner_id=user.id, course_id=course_id, title=title, source_kind=kind, file_name=file_name, content=text)
    db.add(m)
    db.commit()
    return _view(db, m)


def generate(db: Session, user: User, material_id) -> tuple[dict, str | None]:
    """(material view, message for the student). Replaces any earlier questions and flashcards."""
    m = _mine(db, user, material_id)
    out, by, message = None, "basic", None
    if ai.enabled():
        if not ai.take_slot(user.id):
            message = "You've used the AI a lot this hour, so this was made in basic mode. Try again later for better questions."
        else:
            try:
                out, by = ai.ai_generate(m.title, m.content), "ai"
            except ai.AiError as e:
                message = f"{e.message} This was made in basic mode instead."
            except Exception:                       # never let an AI hiccup lose the student's upload
                log.exception("AI generation failed unexpectedly")
                message = "The AI service had a problem, so this was made in basic mode instead."
    if out is None:
        try:
            out = ai.basic_generate(m.title, m.content)
        except ai.AiError as e:
            raise StudyError("text", "TOO_SHORT", e.message)
        if message is None:
            message = "AI isn't set up on this server, so this was made in basic mode."

    for model in (StudyQuestion, StudyCard):
        for row in db.scalars(select(model).where(model.material_id == m.id)):
            db.delete(row)
    pos = 0
    for q in out["mcq"]:
        db.add(StudyQuestion(material_id=m.id, kind="mcq", position=pos, prompt=q["prompt"], options=q["options"],
                             answer_index=q["answer_index"], explanation=q["explanation"] or None))
        pos += 1
    for q in out["short"]:
        db.add(StudyQuestion(material_id=m.id, kind="short", position=pos, prompt=q["prompt"], reference=q["reference"]))
        pos += 1
    for i, c in enumerate(out["cards"]):
        db.add(StudyCard(material_id=m.id, position=i, front=c["front"], back=c["back"]))
    m.notes, m.generated_by, m.generated_at = out["notes"], by, datetime.now(timezone.utc)
    db.commit()
    return _view(db, m), message


def delete_material(db: Session, user: User, material_id) -> None:
    db.delete(_mine(db, user, material_id))
    db.commit()


def questions(db: Session, user: User, material_id, kind: str) -> list[dict]:
    m = _mine(db, user, material_id)
    if kind not in ("mcq", "short"):
        raise StudyError("kind", "INVALID", "Unknown question type.")
    rows = db.scalars(select(StudyQuestion).where(StudyQuestion.material_id == m.id, StudyQuestion.kind == kind)
                      .order_by(StudyQuestion.position))
    return [{"id": q.id, "kind": q.kind, "prompt": q.prompt, "options": q.options if kind == "mcq" else None} for q in rows]


def cards(db: Session, user: User, material_id) -> list[dict]:
    m = _mine(db, user, material_id)
    rows = db.scalars(select(StudyCard).where(StudyCard.material_id == m.id).order_by(StudyCard.position))
    return [{"id": c.id, "front": c.front, "back": c.back, "right": c.right, "wrong": c.wrong, "weak": c.wrong > c.right}
            for c in rows]


def record_card(db: Session, user: User, card_id, knew: bool) -> dict:
    c = db.get(StudyCard, _id(card_id, "Card"))
    if c is None or db.get(StudyMaterial, c.material_id).owner_id != user.id:
        raise StudyError(None, "NOT_FOUND", "Card not found.")
    if knew:
        c.right += 1
    else:
        c.wrong += 1
    db.commit()
    return {"id": c.id, "front": c.front, "back": c.back, "right": c.right, "wrong": c.wrong, "weak": c.wrong > c.right}


def _save_attempt(db: Session, m: StudyMaterial, user: User, kind: str, score: int, total: int) -> None:
    db.add(StudyAttempt(material_id=m.id, owner_id=user.id, kind=kind, score=score, total=total))
    db.commit()


def submit_quiz(db: Session, user: User, material_id, answers: list[dict]) -> dict:
    m = _mine(db, user, material_id)
    qs = list(db.scalars(select(StudyQuestion).where(StudyQuestion.material_id == m.id, StudyQuestion.kind == "mcq")
                         .order_by(StudyQuestion.position)))
    if not qs:
        raise StudyError(None, "NO_QUESTIONS", "Generate questions first.")
    given = {}
    for a in answers or []:
        given[_id(a.get("question_id"), "Question")] = a.get("choice")
    results, score = [], 0
    for q in qs:
        choice = given.get(q.id)
        if not (isinstance(choice, int) and 0 <= choice < len(q.options)):
            choice = None
        ok = choice == q.answer_index
        score += ok
        results.append({"question_id": q.id, "choice": choice, "correct_index": q.answer_index, "correct": ok,
                        "explanation": q.explanation})
    _save_attempt(db, m, user, "quiz", score, len(qs))
    return {"score": score, "total": len(qs), "percent": _pct(score, len(qs)), "results": results, "graded_by": "server"}


def submit_short(db: Session, user: User, material_id, answers: list[dict]) -> dict:
    m = _mine(db, user, material_id)
    qs = list(db.scalars(select(StudyQuestion).where(StudyQuestion.material_id == m.id, StudyQuestion.kind == "short")
                         .order_by(StudyQuestion.position)))
    if not qs:
        raise StudyError(None, "NO_QUESTIONS", "Generate questions first.")
    given = {}
    for a in answers or []:
        text = (a.get("answer") or "").strip()
        if len(text) > MAX_ANSWER:
            raise StudyError("answer", "TOO_LONG", f"Keep each answer under {MAX_ANSWER} characters.")
        given[_id(a.get("question_id"), "Question")] = text
    todo = [q for q in qs if given.get(q.id)]
    marks, by = {}, "basic"
    if todo:
        items = [{"question": q.prompt, "model_answer": q.reference or "", "answer": given[q.id]} for q in todo]
        graded = None
        if ai.enabled() and ai.take_slot(user.id):
            try:
                graded, by = ai.ai_grade(items), "ai"
            except Exception:
                log.exception("AI marking failed")
                graded = None
        if graded is None:
            graded = ai.basic_grade(items)
        marks = {q.id: g for q, g in zip(todo, graded)}
    results, score = [], 0
    for q in qs:
        g = marks.get(q.id, {"score": 0, "feedback": "No answer given."})
        score += g["score"]
        results.append({"question_id": q.id, "answer": given.get(q.id, ""), "score": g["score"],
                        "feedback": g["feedback"], "reference": q.reference or ""})
    total = 2 * len(qs)
    _save_attempt(db, m, user, "short", score, total)
    return {"score": score, "total": total, "percent": _pct(score, total), "results": results, "graded_by": by}


def attempts(db: Session, user: User, material_id) -> list[dict]:
    m = _mine(db, user, material_id)
    rows = db.scalars(select(StudyAttempt).where(StudyAttempt.material_id == m.id)
                      .order_by(StudyAttempt.created_at.desc(), StudyAttempt.id.desc()).limit(50))
    return [{"id": a.id, "kind": a.kind, "score": a.score, "total": a.total, "percent": _pct(a.score, a.total),
             "created_at": a.created_at.isoformat()} for a in rows]


# =============================== GraphQL ===============================

type_defs = """
type StudyTerm { term: String!, meaning: String! }
type StudyNotes { summary: String!, points: [String!]!, terms: [StudyTerm!]! }
type StudyMaterial {
  id: ID!
  title: String!
  course: Course
  sourceKind: String!
  fileName: String
  charCount: Int!
  excerpt: String!
  generatedBy: String
  generatedAt: String
  createdAt: String!
  questionCount: Int!
  shortCount: Int!
  cardCount: Int!
  attempts: Int!
  bestPercent: Int
  notes: StudyNotes
}
type StudyQuestion { id: ID!, kind: String!, prompt: String!, options: [String!] }
type StudyCard { id: ID!, front: String!, back: String!, right: Int!, wrong: Int!, weak: Boolean! }
type StudyAttempt { id: ID!, kind: String!, score: Int!, total: Int!, percent: Int!, createdAt: String! }
type StudyConfig { aiEnabled: Boolean!, maxMb: Int!, maxChars: Int! }

type QuizItem { questionId: ID!, choice: Int, correctIndex: Int!, correct: Boolean!, explanation: String }
type QuizResult { score: Int!, total: Int!, percent: Int!, results: [QuizItem!]! }
type ShortItem { questionId: ID!, answer: String!, score: Int!, feedback: String!, reference: String! }
type ShortResult { score: Int!, total: Int!, percent: Int!, gradedBy: String!, results: [ShortItem!]! }

input StudyInput { title: String, text: String, fileName: String, fileContent: String, courseId: ID }
input QuizAnswer { questionId: ID!, choice: Int }
input ShortAnswer { questionId: ID!, answer: String! }

type StudyMaterialPayload { material: StudyMaterial, errors: [UserError!]! }
type StudyGeneratePayload { material: StudyMaterial, message: String, errors: [UserError!]! }
type StudyQuizPayload { result: QuizResult, errors: [UserError!]! }
type StudyShortPayload { result: ShortResult, errors: [UserError!]! }
type StudyCardPayload { card: StudyCard, errors: [UserError!]! }
type StudyDeletePayload { ok: Boolean!, errors: [UserError!]! }

extend type Query {
  studyConfig: StudyConfig!
  studyMaterials: [StudyMaterial!]!
  studyMaterial(id: ID!): StudyMaterial
  studyQuestions(materialId: ID!, kind: String!): [StudyQuestion!]!
  studyCards(materialId: ID!): [StudyCard!]!
  studyAttempts(materialId: ID!): [StudyAttempt!]!
}

extend type Mutation {
  createStudyMaterial(input: StudyInput!): StudyMaterialPayload!
  generateStudy(materialId: ID!): StudyGeneratePayload!
  deleteStudyMaterial(id: ID!): StudyDeletePayload!
  submitQuiz(materialId: ID!, answers: [QuizAnswer!]!): StudyQuizPayload!
  submitShortAnswers(materialId: ID!, answers: [ShortAnswer!]!): StudyShortPayload!
  recordCard(cardId: ID!, knew: Boolean!): StudyCardPayload!
}
"""

query = QueryType()
mutation = MutationType()


def _read(info, fn):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            return fn(db, user)
        except StudyError as e:
            raise GraphQLError(e.message, extensions={"code": e.code})


def _write(info, key: str, fn):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            return {**fn(db, user), "errors": []}
        except StudyError as e:
            db.rollback()
            return {key: None, "errors": [{"field": e.field, "code": e.code, "message": e.message}]}
        except Exception:                           # the real cause goes to the server log, the student gets a plain message
            db.rollback()
            log.exception("Study request failed")
            return {key: None, "errors": [{"field": None, "code": "FAILED",
                                           "message": "Something went wrong on our side. Please try again."}]}


@query.field("studyConfig")
def resolve_config(_, info):
    with SessionLocal() as db:
        current_user(info, db)
    return {"ai_enabled": ai.enabled(), "max_mb": MAX_MB, "max_chars": MAX_CHARS}


@query.field("studyMaterials")
def resolve_materials(_, info):
    return _read(info, list_materials)


@query.field("studyMaterial")
def resolve_material(_, info, id):
    try:
        return _read(info, lambda db, u: _view(db, _mine(db, u, id)))
    except GraphQLError as e:
        if (e.extensions or {}).get("code") == "NOT_FOUND":
            return None
        raise


@query.field("studyQuestions")
def resolve_questions(_, info, material_id, kind):
    return _read(info, lambda db, u: questions(db, u, material_id, kind))


@query.field("studyCards")
def resolve_cards(_, info, material_id):
    return _read(info, lambda db, u: cards(db, u, material_id))


@query.field("studyAttempts")
def resolve_attempts(_, info, material_id):
    return _read(info, lambda db, u: attempts(db, u, material_id))


@mutation.field("createStudyMaterial")
def resolve_create(_, info, input):
    return _write(info, "material", lambda db, u: {"material": create_material(db, u, input)})


@mutation.field("generateStudy")
def resolve_generate(_, info, material_id):
    def run(db, u):
        view, message = generate(db, u, material_id)
        return {"material": view, "message": message}
    return _write(info, "material", run)


@mutation.field("deleteStudyMaterial")
def resolve_delete(_, info, id):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            delete_material(db, user, id)
        except StudyError as e:
            db.rollback()
            return {"ok": False, "errors": [{"field": e.field, "code": e.code, "message": e.message}]}
        return {"ok": True, "errors": []}


@mutation.field("submitQuiz")
def resolve_quiz(_, info, material_id, answers):
    return _write(info, "result", lambda db, u: {"result": submit_quiz(db, u, material_id, answers)})


@mutation.field("submitShortAnswers")
def resolve_short(_, info, material_id, answers):
    return _write(info, "result", lambda db, u: {"result": submit_short(db, u, material_id, answers)})


@mutation.field("recordCard")
def resolve_card(_, info, card_id, knew):
    return _write(info, "card", lambda db, u: {"card": record_card(db, u, card_id, knew)})