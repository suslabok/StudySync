"""Course sharing: a course becomes a class by getting a join code.

* The course you share is the ORIGINAL. Its owner is the teacher (classroom) or just
  another member (group).
* Joining with the code creates a LINKED COPY of the course in the joiner's current
  semester (source_course_id -> original). It shows up on their dashboard and in their
  tasks like any course. Deleting that copy = leaving. 'Leave' unlinks it but keeps it.
* The stream (posts, comments) belongs to the original; everyone reaches it through
  their own course id. Anyone else gets NOT_FOUND.
"""
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import tasks as task_svc
from app.models import Comment, Course, Post, Semester, User
from app.profile import avatar_url

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I
MODES = ("classroom", "group")


class ShareError(Exception):
    def __init__(self, field: str | None, code: str, message: str):
        self.field, self.code, self.message = field, code, message


def _id(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ShareError(None, "NOT_FOUND", "Not found.")


def person(user: User) -> dict:
    return {"id": user.id, "display_name": user.display_name, "avatar_url": avatar_url(user)}


def _new_code(db: Session) -> str:
    for _ in range(20):
        code = "".join(secrets.choice(ALPHABET) for _ in range(7))
        if db.scalar(select(Course.id).where(Course.join_code == code)) is None:
            return code
    raise ShareError(None, "CODE_FAILED", "Could not create a join code. Try again.")


def _own_course(db: Session, user: User, course_id) -> Course:
    course = db.get(Course, _id(course_id))
    if course is None or course.owner_id != user.id:
        raise ShareError(None, "NOT_FOUND", "Course not found.")
    return course


def _root(db: Session, course: Course) -> Course:
    if course.source_course_id is None:
        return course
    return db.get(Course, course.source_course_id) or course


def _role(root: Course, user: User) -> str:
    if root.share_mode == "group":
        return "member"
    return "teacher" if root.owner_id == user.id else "student"


def _stream_access(db: Session, user: User, course_id) -> tuple[Course, bool]:
    """(root course, is_owner) for a user's own course, or NOT_FOUND if it isn't shared."""
    root = _root(db, _own_course(db, user, course_id))
    if root.share_mode is None:
        raise ShareError(None, "NOT_FOUND", "This course isn't shared.")
    return root, root.owner_id == user.id


# ---- the "space" of a course ----

def space(db: Session, user: User, course_id) -> dict:
    course = _own_course(db, user, course_id)
    root = _root(db, course)
    out = {"course_id": course.id, "code": course.code, "title": course.title, "color": course.color,
           "shared": root.share_mode is not None, "mode": None, "role": None, "is_owner": False,
           "join_code": None, "member_count": 0, "teacher": None, "members": []}
    if root.share_mode is None:
        out["is_owner"] = course.source_course_id is None  # a private, original course can be shared
        return out
    owner = db.get(User, root.owner_id)
    rows = db.execute(select(Course, User).join(User, User.id == Course.owner_id)
                      .where(Course.source_course_id == root.id)).all()
    members = [{"user": person(owner), "role": _role(root, owner), "joined_at": root.created_at.isoformat()}]
    members += [{"user": person(u), "role": _role(root, u), "joined_at": c.created_at.isoformat()}
                for c, u in sorted(rows, key=lambda r: r[1].display_name.lower())]
    is_owner = root.owner_id == user.id
    out.update(
        mode=root.share_mode, role=_role(root, user), is_owner=is_owner,
        # classroom: only the teacher sees the code; group: every member can invite
        join_code=root.join_code if (is_owner or root.share_mode == "group") else None,
        member_count=len(members), teacher=person(owner), members=members,
    )
    return out


def share_course(db: Session, user: User, course_id, mode: str) -> dict:
    course = _own_course(db, user, course_id)
    if course.source_course_id is not None:
        raise ShareError(None, "FORBIDDEN", "You joined this course, so only its owner can manage sharing.")
    if mode not in MODES:
        raise ShareError("mode", "INVALID", "Mode must be classroom or group.")
    course.share_mode = mode
    if course.join_code is None:
        course.join_code = _new_code(db)
    db.commit()
    return space(db, user, course.id)


def regenerate_code(db: Session, user: User, course_id) -> dict:
    course = _own_course(db, user, course_id)
    if course.source_course_id is not None or course.share_mode is None:
        raise ShareError(None, "FORBIDDEN", "Only the owner of a shared course can do that.")
    course.join_code = _new_code(db)
    db.commit()
    return space(db, user, course.id)


def stop_sharing(db: Session, user: User, course_id) -> dict:
    course = _own_course(db, user, course_id)
    if course.source_course_id is not None or course.share_mode is None:
        raise ShareError(None, "FORBIDDEN", "Only the owner of a shared course can do that.")
    course.share_mode = None
    course.join_code = None
    task_svc.drop_course_assignments(db, course.id)                  # assignments and everyone's copies
    db.query(Post).filter(Post.course_id == course.id).delete()  # comments cascade in the DB
    db.query(Course).filter(Course.source_course_id == course.id).update({Course.source_course_id: None})
    db.commit()
    return space(db, user, course.id)


def join_course(db: Session, user: User, code: str) -> dict:
    code = (code or "").strip().upper().replace(" ", "").replace("-", "")
    root = db.scalar(select(Course).where(Course.join_code == code, Course.share_mode.is_not(None))) if code else None
    if root is None:
        raise ShareError("code", "NOT_FOUND", "No course matches that code.")
    if root.owner_id == user.id:
        raise ShareError("code", "OWN_COURSE", "That's your own course.")
    existing = db.scalar(select(Course).where(Course.owner_id == user.id, Course.source_course_id == root.id))
    if existing is None:
        semester = db.scalar(select(Semester).where(Semester.owner_id == user.id, Semester.is_current.is_(True)))
        if semester is None:
            raise ShareError("code", "NO_SEMESTER", "Set up your current semester first. The course is added to it.")
        existing = Course(owner_id=user.id, semester_id=semester.id, code=root.code, title=root.title,
                          color=root.color, source_course_id=root.id)
        db.add(existing)
        db.flush()
        task_svc.give_member_assignments(db, user, existing, root)  # work already set on the course
        db.commit()
    return space(db, user, existing.id)  # joining twice is harmless


def leave_course(db: Session, user: User, course_id) -> None:
    course = _own_course(db, user, course_id)
    if course.source_course_id is None:
        raise ShareError(None, "OWNER", "You own this course. Stop sharing it instead.")
    task_svc.drop_member_assignments(db, user, course.source_course_id)
    course.source_course_id = None  # keeps the course, now private to you
    db.commit()


# ---- stream ----

def _clean_body(body: str, limit: int) -> str:
    body = (body or "").strip()
    if not body:
        raise ShareError("body", "REQUIRED", "Write something first.")
    if len(body) > limit:
        raise ShareError("body", "TOO_LONG", f"Keep it under {limit} characters.")
    return body


def list_posts(db: Session, user: User, course_id, limit: int = 50) -> list[dict]:
    root, owner = _stream_access(db, user, course_id)
    posts = db.execute(select(Post, User).join(User, User.id == Post.author_id)
                       .where(Post.course_id == root.id)
                       .order_by(Post.created_at.desc(), Post.id.desc()).limit(max(1, min(limit, 100)))).all()
    ids = [p.id for p, _ in posts]
    by_post: dict[int, list[dict]] = {i: [] for i in ids}
    if ids:
        rows = db.execute(select(Comment, User).join(User, User.id == Comment.author_id)
                          .where(Comment.post_id.in_(ids)).order_by(Comment.created_at, Comment.id)).all()
        for c, u in rows:
            by_post[c.post_id].append({"id": c.id, "body": c.body, "created_at": c.created_at.isoformat(),
                                       "author": person(u), "can_delete": owner or c.author_id == user.id})
    return [{"id": p.id, "body": p.body, "created_at": p.created_at.isoformat(), "author": person(u),
             "can_delete": owner or p.author_id == user.id, "comments": by_post[p.id]} for p, u in posts]


def create_post(db: Session, user: User, course_id, body: str, uploads: list[dict] | None = None) -> None:
    """Anyone in the course can post, with text, files or both."""
    from app import files as fs          # imported here: files.py needs this module, so not at the top
    root, _ = _stream_access(db, user, course_id)
    try:
        checked = fs.check_many(uploads)
    except fs.TaskError as e:
        raise ShareError("files", e.code, e.message)
    body = (body or "").strip()
    if not body and not checked:
        raise ShareError("body", "REQUIRED", "Write something or attach a file first.")
    if body:
        body = _clean_body(body, 5000)
    post = Post(course_id=root.id, author_id=user.id, body=body)
    db.add(post)
    db.flush()
    keys = fs.add_post_files(db, user, post.id, checked)
    try:
        db.commit()
    except Exception:
        db.rollback()
        fs.remove_blobs(keys)
        raise


def _post_access(db: Session, user: User, post_id) -> tuple[Post, bool]:
    """The post plus whether `user` may moderate it. Users outside the course get NOT_FOUND."""
    post = db.get(Post, _id(post_id))
    if post is None:
        raise ShareError(None, "NOT_FOUND", "Post not found.")
    root = db.get(Course, post.course_id)
    is_owner = root.owner_id == user.id
    in_course = is_owner or db.scalar(select(Course.id).where(
        Course.owner_id == user.id, Course.source_course_id == root.id)) is not None
    if root.share_mode is None or not in_course:
        raise ShareError(None, "NOT_FOUND", "Post not found.")
    return post, is_owner


def delete_post(db: Session, user: User, post_id) -> None:
    post, owner = _post_access(db, user, post_id)
    if not owner and post.author_id != user.id:
        raise ShareError(None, "FORBIDDEN", "You can only delete your own posts.")
    from app import files as fs
    keys = fs.post_file_keys(db, post.id)
    db.delete(post)
    db.commit()
    fs.remove_blobs(keys)


def create_comment(db: Session, user: User, post_id, body: str) -> None:
    post, _ = _post_access(db, user, post_id)
    db.add(Comment(post_id=post.id, author_id=user.id, body=_clean_body(body, 2000)))
    db.commit()


def delete_comment(db: Session, user: User, comment_id) -> None:
    comment = db.get(Comment, _id(comment_id))
    if comment is None:
        raise ShareError(None, "NOT_FOUND", "Comment not found.")
    _, owner = _post_access(db, user, comment.post_id)
    if not owner and comment.author_id != user.id:
        raise ShareError(None, "FORBIDDEN", "You can only delete your own comments.")
    db.delete(comment)
    db.commit()