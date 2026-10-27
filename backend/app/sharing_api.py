from ariadne import MutationType, QueryType

from app import sharing as svc
from app.database import SessionLocal
from app.schema import current_user

type_defs = """
type Person { id: ID!, displayName: String!, avatarUrl: String }
type SpaceMember { user: Person!, role: String!, joinedAt: String! }

type CourseSpace {
  courseId: ID!
  code: String!
  title: String!
  color: String!
  shared: Boolean!
  mode: String
  role: String
  isOwner: Boolean!
  joinCode: String
  memberCount: Int!
  teacher: Person
  members: [SpaceMember!]!
}

type Comment { id: ID!, body: String!, createdAt: String!, author: Person!, canDelete: Boolean! }
type Post { id: ID!, body: String!, createdAt: String!, author: Person!, canDelete: Boolean!, comments: [Comment!]! }

type SpacePayload { space: CourseSpace, errors: [UserError!]! }
type OkPayload { ok: Boolean!, errors: [UserError!]! }

extend type Query {
  courseSpace(courseId: ID!): CourseSpace
  posts(courseId: ID!, limit: Int = 50): [Post!]!
}

extend type Mutation {
  shareCourse(courseId: ID!, mode: String!): SpacePayload!
  regenerateJoinCode(courseId: ID!): SpacePayload!
  stopSharing(courseId: ID!): SpacePayload!
  joinCourse(code: String!): SpacePayload!
  leaveCourse(courseId: ID!): OkPayload!
  createPost(courseId: ID!, body: String!): OkPayload!
  deletePost(id: ID!): OkPayload!
  createComment(postId: ID!, body: String!): OkPayload!
  deleteComment(id: ID!): OkPayload!
}
"""

query = QueryType()
mutation = MutationType()


def _errors(e: svc.ShareError) -> list[dict]:
    return [{"field": e.field, "code": e.code, "message": e.message}]


@query.field("courseSpace")
def resolve_space(_, info, course_id):
    with SessionLocal() as db:
        try:
            return svc.space(db, current_user(info, db), course_id)
        except svc.ShareError:
            return None


@query.field("posts")
def resolve_posts(_, info, course_id, limit=50):
    with SessionLocal() as db:
        try:
            return svc.list_posts(db, current_user(info, db), course_id, limit)
        except svc.ShareError:
            return []


def _run(info, fn, key: str):
    """key == 'space' returns the object, key == 'ok' returns True."""
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            result = fn(db, user)
        except svc.ShareError as e:
            db.rollback()
            return {key: None if key == "space" else False, "errors": _errors(e)}
        return {key: result if key == "space" else True, "errors": []}


@mutation.field("shareCourse")
def resolve_share(_, info, course_id, mode):
    return _run(info, lambda db, u: svc.share_course(db, u, course_id, mode), "space")


@mutation.field("regenerateJoinCode")
def resolve_regen(_, info, course_id):
    return _run(info, lambda db, u: svc.regenerate_code(db, u, course_id), "space")


@mutation.field("stopSharing")
def resolve_stop(_, info, course_id):
    return _run(info, lambda db, u: svc.stop_sharing(db, u, course_id), "space")


@mutation.field("joinCourse")
def resolve_join(_, info, code):
    return _run(info, lambda db, u: svc.join_course(db, u, code), "space")


@mutation.field("leaveCourse")
def resolve_leave(_, info, course_id):
    return _run(info, lambda db, u: svc.leave_course(db, u, course_id), "ok")


@mutation.field("createPost")
def resolve_create_post(_, info, course_id, body):
    return _run(info, lambda db, u: svc.create_post(db, u, course_id, body), "ok")


@mutation.field("deletePost")
def resolve_delete_post(_, info, id):
    return _run(info, lambda db, u: svc.delete_post(db, u, id), "ok")


@mutation.field("createComment")
def resolve_create_comment(_, info, post_id, body):
    return _run(info, lambda db, u: svc.create_comment(db, u, post_id, body), "ok")


@mutation.field("deleteComment")
def resolve_delete_comment(_, info, id):
    return _run(info, lambda db, u: svc.delete_comment(db, u, id), "ok")