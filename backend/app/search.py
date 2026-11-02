"""Full-text search with PostgreSQL (`to_tsvector` / `websearch_to_tsquery`).

Searches what the signed-in user may see: their own tasks, plus the stream posts, comments and
assignments of courses they own or have joined. Results are ranked and carry a short highlighted snippet.
Matches are wrapped in ⟦ ⟧ so the page can highlight them without trusting any HTML.
Register in api.py: search.type_defs, search.query.
"""
from ariadne import QueryType
from sqlalchemy import func, literal_column, select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Assignment, Comment, Course, Post, Task, User
from app.schema import current_user

MIN_LEN, MAX_LEN = 2, 200
PER_SOURCE, TOTAL = 15, 30
CONFIG = literal_column("'english'")
HEADLINE = "StartSel=⟦, StopSel=⟧, MaxFragments=1, MaxWords=24, MinWords=8, ShortWord=2"


def vector(*cols):
    """The expression the GIN indexes in the migration are built on. Keep the two in step."""
    parts = [func.coalesce(c, "") for c in cols]
    text = parts[0]
    for p in parts[1:]:
        text = text + literal_column("' '") + p
    return func.to_tsvector(CONFIG, text), text


def _hits(db: Session, q, kind: str, cols, extra_cols, where, tsq):
    vec, text = vector(*cols)
    rank = func.ts_rank(vec, tsq)
    stmt = (select(rank.label("rank"), func.ts_headline(CONFIG, text, tsq, HEADLINE).label("snippet"), *extra_cols)
            .where(vec.op("@@")(tsq), *where).order_by(rank.desc()).limit(PER_SOURCE))
    return [{"kind": kind, **dict(r._mapping)} for r in db.execute(stmt)]


def search(db: Session, user: User, q: str) -> list[dict]:
    q = (q or "").strip()[:MAX_LEN]
    if len(q) < MIN_LEN:
        return []
    tsq = func.websearch_to_tsquery(CONFIG, q)

    mine = db.scalars(select(Course).where(Course.owner_id == user.id)).all()
    own_of = {c.source_course_id or c.id: c for c in mine}            # shared root id -> my own course
    roots = [rid for rid, c in own_of.items()
             if db.scalar(select(Course.share_mode).where(Course.id == rid)) is not None]

    rows = []
    rows += _hits(db, q, "task", (Task.title, Task.notes), (Task.id.label("id"), Task.title.label("title"),
                  Task.course_id.label("own_course"), Task.created_at.label("created_at")),
                  [Task.owner_id == user.id, Task.assignment_id.is_(None)], tsq)   # assigned work shows up as the assignment
    if roots:
        rows += _hits(db, q, "post", (Post.body,), (Post.id.label("id"), Post.body.label("title"),
                      Post.course_id.label("root"), Post.created_at.label("created_at")),
                      [Post.course_id.in_(roots)], tsq)
        rows += _hits(db, q, "comment", (Comment.body,), (Comment.id.label("id"), Comment.body.label("title"),
                      Post.course_id.label("root"), Comment.created_at.label("created_at")),
                      [Comment.post_id == Post.id, Post.course_id.in_(roots)], tsq)
        rows += _hits(db, q, "assignment", (Assignment.title, Assignment.notes),
                      (Assignment.id.label("id"), Assignment.title.label("title"),
                       Assignment.course_id.label("root"), Assignment.created_at.label("created_at")),
                      [Assignment.course_id.in_(roots)], tsq)

    rows.sort(key=lambda r: -float(r["rank"]))
    out = []
    for r in rows[:TOTAL]:
        own = r.get("own_course")
        course = db.get(Course, own) if own else own_of.get(r.get("root"))
        title = r["title"] if r["kind"] in ("task", "assignment") else None
        out.append({"kind": r["kind"], "id": r["id"], "title": title, "snippet": r["snippet"],
                    "course": course, "created_at": r["created_at"].isoformat()})
    return out


type_defs = """
type SearchResult {
  kind: String!        # task | post | comment | assignment
  id: ID!
  title: String
  snippet: String!     # matches are wrapped in ⟦ ⟧
  course: Course
  createdAt: String!
}
extend type Query { search(q: String!): [SearchResult!]! }
"""

query = QueryType()


@query.field("search")
def resolve_search(_, info, q):
    with SessionLocal() as db:
        return search(db, current_user(info, db), q)