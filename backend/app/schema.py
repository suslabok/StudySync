import os

from ariadne import MutationType, ObjectType, QueryType, make_executable_schema
from graphql import GraphQLError

from app.auth import (REFRESH_DAYS, AuthError, authenticate, authenticate_google,
                      create_access_token, decode_access_token, issue_refresh_token,
                      logout_refresh_token, register_user, rotate_refresh_token)
from app.database import SessionLocal
from app.models import User

REFRESH_COOKIE = "refresh_token"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "0") == "1"   # set to 1 behind HTTPS

type_defs = """
type UserError { field: String, code: String!, message: String! }
type User { id: ID!, email: String!, displayName: String!, timezone: String!, onboarded: Boolean! }
type AuthPayload { accessToken: String, user: User, errors: [UserError!]! }

type Query { health: String!, me: User! }

type Mutation {
  register(email: String!, password: String!, displayName: String!): AuthPayload!
  login(email: String!, password: String!): AuthPayload!
  googleLogin(idToken: String!): AuthPayload!
  refreshToken: AuthPayload!
  logout: Boolean!
}
"""

query, mutation, user_type = QueryType(), MutationType(), ObjectType("User")


def unauthenticated(message="Not authenticated") -> GraphQLError:
    return GraphQLError(message, extensions={"code": "UNAUTHENTICATED"})


def current_user(info, db) -> User:
    header = info.context["request"].headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise unauthenticated()
    try:
        user_id = decode_access_token(token)
    except AuthError:
        raise unauthenticated("Invalid or expired token")
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise unauthenticated()
    return user


def _cookies(info) -> list[str]:
    return info.context["request"].scope["pending_cookies"]


def _set_refresh_cookie(info, raw: str | None) -> None:
    value, age = (raw, REFRESH_DAYS * 86400) if raw else ("", 0)
    cookie = f"{REFRESH_COOKIE}={value}; Max-Age={age}; Path=/graphql; HttpOnly; SameSite=Lax"
    _cookies(info).append(cookie + ("; Secure" if COOKIE_SECURE else ""))


def _error_payload(e: AuthError) -> dict:
    return {"access_token": None, "user": None,
            "errors": [{"field": e.field, "code": e.code, "message": e.message}]}


def _success(info, db, user: User, refresh_raw: str) -> dict:
    _set_refresh_cookie(info, refresh_raw)
    return {"access_token": create_access_token(user.id), "user": user, "errors": []}


@query.field("health")
def resolve_health(*_):
    return "ok"


@query.field("me")
def resolve_me(_, info):
    with SessionLocal() as db:
        return current_user(info, db)


@user_type.field("onboarded")
def resolve_onboarded(user, _):
    return user.onboarded_at is not None


@mutation.field("register")
def resolve_register(_, info, email, password, display_name):
    with SessionLocal() as db:
        try:
            user = register_user(db, email, password, display_name)
        except AuthError as e:
            return _error_payload(e)
        raw = issue_refresh_token(db, user.id)
        db.commit()
        return _success(info, db, user, raw)


@mutation.field("login")
def resolve_login(_, info, email, password):
    with SessionLocal() as db:
        try:
            user = authenticate(db, email, password)
        except AuthError as e:
            return _error_payload(e)
        raw = issue_refresh_token(db, user.id)
        db.commit()
        return _success(info, db, user, raw)


@mutation.field("googleLogin")
def resolve_google_login(_, info, id_token):
    with SessionLocal() as db:
        try:
            user = authenticate_google(db, id_token)
        except AuthError as e:
            return _error_payload(e)
        raw = issue_refresh_token(db, user.id)
        db.commit()
        return _success(info, db, user, raw)


@mutation.field("refreshToken")
def resolve_refresh(_, info):
    request = info.context["request"]
    # custom header: a plain cross-site form post cannot set it
    if request.headers.get("x-requested-with") != "studysync":
        raise unauthenticated("Missing request header")
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise unauthenticated("No refresh token")
    with SessionLocal() as db:
        try:
            user, new_raw = rotate_refresh_token(db, raw)
        except AuthError as e:
            _set_refresh_cookie(info, None)
            raise unauthenticated(e.message)
        return _success(info, db, user, new_raw)


@mutation.field("logout")
def resolve_logout(_, info):
    with SessionLocal() as db:
        logout_refresh_token(db, info.context["request"].cookies.get(REFRESH_COOKIE))
    _set_refresh_cookie(info, None)
    return True


schema = make_executable_schema(type_defs, query, mutation, user_type,
                                convert_names_case=True)