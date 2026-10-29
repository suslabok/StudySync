"""Task and assignment files, written answers, and the assigner's view of submissions.

Everything for this feature lives here: storage (disk), the service rules, and the GraphQL
schema/resolvers. The TaskFile table class is in models.py so Alembic can see it.
Register it in api.py (files_api.type_defs, files_api.query, files_api.mutation).

Who may do what:
  * stream post files: everyone in the course can read; they go with the post (made in sharing.create_post).
  * assignment files: anyone in the course can read; whoever set the assignment can add or delete.
  * task files and answers: the task's owner can read, add and delete; the assignment's author and the
    course's teacher can read (that is how an assigner sees what others handed in); nobody else can.
"""
import base64
import binascii
import os
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path

from ariadne import MutationType, ObjectType, QueryType
from graphql import GraphQLError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import tasks as tsk
from app.database import SessionLocal
from app.models import Assignment, Course, Task, TaskFile, User
from app.schema import current_user
from app.tasks import TaskError

# =============================== storage ===============================
MEDIA_DIR = Path(os.environ.get("MEDIA_DIR", "media")).resolve() / "task_files"
MAX_MB = int(os.environ.get("MAX_UPLOAD_MB", "5"))
MAX_BYTES = MAX_MB * 1024 * 1024
MAX_FILES_PER_PARENT = 10

ALLOWED = {
    "pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "txt": "text/plain", "md": "text/markdown", "csv": "text/csv", "zip": "application/zip",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
_KEY = re.compile(r"^[0-9a-f]{32}$")


class FileProblem(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def clean_name(name: str) -> str:
    """Last path segment only, no control characters, bounded length."""
    name = (name or "").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip().strip(".")
    if "." in name and len(name) > 150:
        name = name[:140] + "." + name.rsplit(".", 1)[-1]
    return name


def _looks_right(ext: str, data: bytes) -> bool:
    """Check the first bytes, so a renamed file can't pass as something else."""
    if ext == "pdf":
        return data.startswith(b"%PDF-")
    if ext == "png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if ext in ("jpg", "jpeg"):
        return data.startswith(b"\xff\xd8\xff")
    if ext in ("docx", "pptx", "xlsx", "zip"):
        return data.startswith(b"PK\x03\x04")
    try:                                    # txt, md, csv
        data.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return b"\x00" not in data


def check_upload(name: str, data: bytes) -> tuple[str, str]:
    """Validate an upload. Returns (clean name, mime type) or raises FileProblem."""
    name = clean_name(name)
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ALLOWED:
        raise FileProblem("TYPE", "That file type isn't allowed. Use PDF, images, text, Office files or ZIP.")
    if not data:
        raise FileProblem("EMPTY", "The file is empty.")
    if len(data) > MAX_BYTES:
        raise FileProblem("TOO_LARGE", f"Files can be up to {MAX_MB} MB.")
    if not _looks_right(ext, data):
        raise FileProblem("TYPE", "The file's content doesn't match its extension.")
    return name, ALLOWED[ext]


def save_blob(data: bytes) -> str:
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    key = secrets.token_hex(16)
    (MEDIA_DIR / key).write_bytes(data)
    return key


def read_blob(key: str) -> bytes:
    if not _KEY.match(key):
        raise FileNotFoundError(key)
    return (MEDIA_DIR / key).read_bytes()


def remove_blobs(keys: list[str]) -> None:
    for key in keys:
        if _KEY.match(key):
            try:
                (MEDIA_DIR / key).unlink()
            except OSError:
                pass


def keys_where(db: Session, condition) -> list[str]:
    """Storage keys of the files matching `condition`, collected before their rows are deleted."""
    return list(db.scalars(select(TaskFile.storage_key).where(condition)))


# =============================== service ===============================

KINDS = ("TASK", "ASSIGNMENT")
MAX_ANSWER = 20_000


def _kind(kind: str) -> str:
    k = (kind or "").upper()
    if k not in KINDS:
        raise TaskError("kind", "INVALID", "Unknown file target.")
    return k


def _int(value, message: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        raise TaskError(None, "NOT_FOUND", message)


def _not_submitted(task: Task) -> None:
    if task.submitted_at is not None:
        raise TaskError(None, "SUBMITTED", "You already handed this in. Unsubmit it to change your work.")


def _info(f: TaskFile, can_delete: bool) -> dict:
    return {"id": f.id, "name": f.original_name, "mime_type": f.mime_type,
            "size_bytes": f.size_bytes, "can_delete": can_delete}


def _task_view(db: Session, user: User, task_id) -> tuple[Task, bool]:
    """(task, is_owner). The owner, the assignment's author and the course's teacher may view."""
    task = db.get(Task, _int(task_id, "Task not found."))
    if task is None:
        raise TaskError(None, "NOT_FOUND", "Task not found.")
    if task.owner_id == user.id:
        return task, True
    if task.assignment_id is not None:
        a = db.get(Assignment, task.assignment_id)
        root = db.get(Course, a.course_id) if a else None
        if a is not None and root is not None and user.id in (a.author_id, root.owner_id):
            return task, False
    raise TaskError(None, "NOT_FOUND", "Task not found.")   # other people's ids look like missing ones


def _file_access(db: Session, user: User, file_id) -> tuple[TaskFile, bool]:
    """(file, may delete). Raises NOT_FOUND when the user may not even see it."""
    f = db.get(TaskFile, _int(file_id, "File not found."))
    if f is None:
        raise TaskError(None, "NOT_FOUND", "File not found.")
    if f.post_id is not None:
        sh = tsk._sh()
        try:
            sh._post_access(db, user, f.post_id)           # anyone in the course may read a post's files
        except sh.ShareError:
            raise TaskError(None, "NOT_FOUND", "File not found.")
        return f, False                                    # a post's files go when the post is deleted
    if f.task_id is not None:
        _, owner = _task_view(db, user, f.task_id)
        return f, owner
    _, _, can_edit = tsk._assignment_access(db, user, f.assignment_id)
    return f, can_edit


def decode_upload(name: str, content: str) -> tuple[str, str, bytes]:
    """base64 -> (clean name, mime type, bytes), or TaskError on a bad upload."""
    content = content or ""
    if len(content) > MAX_BYTES * 4 // 3 + 8:           # reject before decoding a huge string
        raise TaskError("file", "TOO_LARGE", f"Files can be up to {MAX_MB} MB.")
    try:
        data = base64.b64decode(content, validate=True)
    except (binascii.Error, ValueError):
        raise TaskError("file", "INVALID", "The file could not be read.")
    try:
        clean, mime = check_upload(name, data)
    except FileProblem as e:
        raise TaskError("file", e.code, e.message)
    return clean, mime, data


def check_many(uploads: list[dict] | None) -> list[tuple[str, str, bytes]]:
    """Validate every upload of one post before anything is stored."""
    uploads = uploads or []
    if len(uploads) > MAX_FILES_PER_PARENT:
        raise TaskError("file", "TOO_MANY", f"You can attach up to {MAX_FILES_PER_PARENT} files here.")
    return [decode_upload(u.get("name"), u.get("content")) for u in uploads]


def add_post_files(db: Session, user: User, post_id: int, checked: list[tuple[str, str, bytes]]) -> list[str]:
    """Store validated files for a post (caller commits). Returns the disk keys so a failed commit can clean up."""
    keys: list[str] = []
    for clean, mime, data in checked:
        key = save_blob(data)
        keys.append(key)
        db.add(TaskFile(uploader_id=user.id, post_id=post_id, storage_key=key, original_name=clean,
                        mime_type=mime, size_bytes=len(data)))
    return keys


def post_file_keys(db: Session, post_id: int) -> list[str]:
    return keys_where(db, TaskFile.post_id == post_id)


# ---- files ----

def list_files(db: Session, user: User, kind: str, parent_id) -> list[dict]:
    if _kind(kind) == "TASK":
        task, owner = _task_view(db, user, parent_id)
        rows = db.scalars(select(TaskFile).where(TaskFile.task_id == task.id).order_by(TaskFile.id))
        return [_info(f, owner) for f in rows]
    a, _, can_edit = tsk._assignment_access(db, user, parent_id)
    rows = db.scalars(select(TaskFile).where(TaskFile.assignment_id == a.id).order_by(TaskFile.id))
    return [_info(f, can_edit) for f in rows]


def attach_file(db: Session, user: User, kind: str, parent_id, name: str, content: str) -> dict:
    if _kind(kind) == "TASK":
        task, owner = _task_view(db, user, parent_id)
        if not owner:
            raise TaskError(None, "FORBIDDEN", "You can only attach files to your own work.")
        _not_submitted(task)
        where, parent = TaskFile.task_id == task.id, {"task_id": task.id}
    else:
        a, _, can_edit = tsk._assignment_access(db, user, parent_id)
        if not can_edit:
            raise TaskError(None, "FORBIDDEN", "Only whoever set this can attach files to it.")
        where, parent = TaskFile.assignment_id == a.id, {"assignment_id": a.id}

    clean, mime, data = decode_upload(name, content)
    count = db.scalar(select(func.count()).select_from(TaskFile).where(where)) or 0
    if count >= MAX_FILES_PER_PARENT:
        raise TaskError("file", "TOO_MANY", f"You can attach up to {MAX_FILES_PER_PARENT} files here.")

    key = save_blob(data)
    f = TaskFile(uploader_id=user.id, storage_key=key, original_name=clean, mime_type=mime,
                 size_bytes=len(data), **parent)
    db.add(f)
    try:
        db.commit()
    except Exception:
        db.rollback()
        remove_blobs([key])
        raise
    return _info(f, True)


def delete_file(db: Session, user: User, file_id) -> None:
    f, can_delete = _file_access(db, user, file_id)
    if not can_delete:
        raise TaskError(None, "FORBIDDEN", "You can't delete this file.")
    if f.task_id is not None:
        _not_submitted(db.get(Task, f.task_id))
    key = f.storage_key
    db.delete(f)
    db.commit()
    remove_blobs([key])


def file_content(db: Session, user: User, file_id) -> dict:
    f, _ = _file_access(db, user, file_id)
    try:
        data = read_blob(f.storage_key)
    except OSError:
        raise TaskError(None, "NOT_FOUND", "The file is missing on the server.")
    return {"name": f.original_name, "mime_type": f.mime_type, "content": base64.b64encode(data).decode("ascii")}


# ---- written answers ----

def _work(task: Task) -> dict:
    return {"task_id": task.id, "status": task.status, "assigned": task.assignment_id is not None,
            "answer": task.answer, "submitted_at": task.submitted_at.isoformat() if task.submitted_at else None}


def get_work(db: Session, user: User, task_id) -> dict:
    return _work(tsk.get_task(db, user, task_id))          # only the owner reads their own draft here


def save_work(db: Session, user: User, task_id, answer: str | None, submit: bool = False,
              unsubmit: bool = False) -> dict:
    task = tsk.get_task(db, user, task_id)
    if unsubmit:
        task.submitted_at, task.status, task.completed_at = None, "doing", None
        db.commit()
        return _work(task)
    if answer is not None:
        _not_submitted(task)
        answer = answer.strip() or None
        if answer and len(answer) > MAX_ANSWER:
            raise TaskError("answer", "TOO_LONG", f"Keep the answer under {MAX_ANSWER} characters.")
        task.answer = answer
    if submit:
        _not_submitted(task)
        files = db.scalar(select(func.count()).select_from(TaskFile).where(TaskFile.task_id == task.id)) or 0
        if not task.answer and not files:
            raise TaskError("answer", "REQUIRED", "Write an answer or attach a file first.")
        now = datetime.now(timezone.utc)
        task.submitted_at, task.status, task.completed_at = now, "done", now
    db.commit()
    return _work(task)


# ---- what the assigner sees ----

def list_submissions(db: Session, user: User, assignment_id) -> list[dict]:
    a, _, can_edit = tsk._assignment_access(db, user, assignment_id)
    if not can_edit:
        raise TaskError(None, "FORBIDDEN", "Only whoever set this can see submissions.")
    tasks = list(db.scalars(select(Task).where(Task.assignment_id == a.id)))
    if not tasks:
        return []
    ids = [t.id for t in tasks]
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_({t.owner_id for t in tasks})))}
    by_task: dict[int, list[dict]] = {i: [] for i in ids}
    for f in db.scalars(select(TaskFile).where(TaskFile.task_id.in_(ids)).order_by(TaskFile.id)):
        by_task[f.task_id].append(_info(f, False))        # the assigner can read but not delete
    person = tsk._sh().person
    rows = [{"task_id": t.id, "student": person(users[t.owner_id]), "status": t.status, "answer": t.answer,
             "submitted_at": t.submitted_at.isoformat() if t.submitted_at else None, "files": by_task[t.id]}
            for t in tasks]
    rows.sort(key=lambda r: (r["submitted_at"] is None, r["student"]["display_name"].lower()))
    return rows


# GraphQL

type_defs = """
enum FileParent { TASK ASSIGNMENT }

type FileInfo { id: ID!, name: String!, mimeType: String!, sizeBytes: Int!, canDelete: Boolean! }
type FileContent { name: String!, mimeType: String!, content: String! }   # content is base64
type FilePayload { file: FileInfo, errors: [UserError!]! }

extend type Post { files: [FileInfo!]! }

type TaskWork { taskId: ID!, status: String!, assigned: Boolean!, answer: String, submittedAt: String }
type WorkPayload { work: TaskWork, errors: [UserError!]! }

type Submission {
  taskId: ID!
  student: Person!
  status: String!
  submittedAt: String
  answer: String
  files: [FileInfo!]!
}

extend type Query {
  files(kind: FileParent!, parentId: ID!): [FileInfo!]!
  fileContent(id: ID!): FileContent!
  taskWork(taskId: ID!): TaskWork!
  submissions(assignmentId: ID!): [Submission!]!
}

extend type Mutation {
  attachFile(kind: FileParent!, parentId: ID!, name: String!, content: String!): FilePayload!
  deleteFile(id: ID!): OkPayload!
  saveWork(taskId: ID!, answer: String, submit: Boolean = false, unsubmit: Boolean = false): WorkPayload!
}
"""

query = QueryType()
mutation = MutationType()
post_type = ObjectType("Post")


@post_type.field("files")
def resolve_post_files(post, _):
    """Files on a stream post. The post list was already limited to people in the course."""
    with SessionLocal() as db:
        rows = db.scalars(select(TaskFile).where(TaskFile.post_id == int(post["id"])).order_by(TaskFile.id))
        return [_info(f, False) for f in rows]


def _read(info, fn):
    """Queries: a rule violation becomes a GraphQL error with a code."""
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            return fn(db, user)
        except TaskError as e:
            raise GraphQLError(e.message, extensions={"code": e.code})


def _write(info, fn, key: str):
    """Mutations: a rule violation becomes the payload's errors list."""
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            result = fn(db, user)
        except TaskError as e:
            db.rollback()
            return {key: False if key == "ok" else None,
                    "errors": [{"field": e.field, "code": e.code, "message": e.message}]}
        return {key: True if key == "ok" else result, "errors": []}


@query.field("files")
def resolve_files(_, info, kind, parent_id):
    return _read(info, lambda db, u: list_files(db, u, kind, parent_id))


@query.field("fileContent")
def resolve_file_content(_, info, id):
    return _read(info, lambda db, u: file_content(db, u, id))


@query.field("taskWork")
def resolve_task_work(_, info, task_id):
    return _read(info, lambda db, u: get_work(db, u, task_id))


@query.field("submissions")
def resolve_submissions(_, info, assignment_id):
    return _read(info, lambda db, u: list_submissions(db, u, assignment_id))


@mutation.field("attachFile")
def resolve_attach(_, info, kind, parent_id, name, content):
    return _write(info, lambda db, u: attach_file(db, u, kind, parent_id, name, content), "file")


@mutation.field("deleteFile")
def resolve_delete_file(_, info, id):
    return _write(info, lambda db, u: delete_file(db, u, id), "ok")


@mutation.field("saveWork")
def resolve_save_work(_, info, task_id, answer=None, submit=False, unsubmit=False):
    return _write(info, lambda db, u: save_work(db, u, task_id, answer, submit, unsubmit), "work")