from ariadne import MutationType, ObjectType

from app import profile as svc
from app.auth import AuthError, issue_refresh_token
from app.database import SessionLocal
from app.schema import _set_refresh_cookie, current_user

type_defs = """
type ProfilePayload { user: User, errors: [UserError!]! }

extend type User {
  hasPassword: Boolean!
  googleLinked: Boolean!
  createdAt: String!
  avatarUrl: String
}

extend type Mutation {
  updateProfile(displayName: String!, timezone: String!): ProfilePayload!
  changePassword(currentPassword: String, newPassword: String!): ProfilePayload!
  uploadAvatar(image: String!): ProfilePayload!
  removeAvatar: ProfilePayload!
}
"""

mutation = MutationType()
user_extra = ObjectType("User")


@user_extra.field("hasPassword")
def resolve_has_password(user, _):
    return user.password_hash is not None


@user_extra.field("googleLinked")
def resolve_google_linked(user, _):
    return user.google_sub is not None


@user_extra.field("createdAt")
def resolve_created_at(user, _):
    return user.created_at.isoformat()


@user_extra.field("avatarUrl")
def resolve_avatar_url(user, _):
    return svc.avatar_url(user)


def _errors(e: AuthError) -> list[dict]:
    return [{"field": e.field, "code": e.code, "message": e.message}]


@mutation.field("updateProfile")
def resolve_update_profile(_, info, display_name, timezone):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            svc.update_profile(db, user, display_name, timezone)
        except AuthError as e:
            db.rollback()
            return {"user": None, "errors": _errors(e)}
        return {"user": user, "errors": []}


@mutation.field("changePassword")
def resolve_change_password(_, info, new_password, current_password=None):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            svc.change_password(db, user, current_password, new_password)
        except AuthError as e:
            db.rollback()
            return {"user": None, "errors": _errors(e)}
        raw = issue_refresh_token(db, user.id)      # keep THIS session signed in
        db.commit()
        _set_refresh_cookie(info, raw)
        return {"user": user, "errors": []}


@mutation.field("uploadAvatar")
def resolve_upload_avatar(_, info, image):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            svc.save_avatar(db, user, image)
        except AuthError as e:
            return {"user": None, "errors": _errors(e)}
        return {"user": user, "errors": []}


@mutation.field("removeAvatar")
def resolve_remove_avatar(_, info):
    with SessionLocal() as db:
        user = current_user(info, db)
        svc.remove_avatar(db, user)
        return {"user": user, "errors": []}