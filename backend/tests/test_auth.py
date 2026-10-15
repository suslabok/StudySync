from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app import auth
from tests.conftest import gql

REGISTER = """mutation($e:String!,$p:String!,$n:String!){
  register(email:$e,password:$p,displayName:$n){
    accessToken user{id email displayName onboarded} errors{field code message}}}"""
LOGIN = """mutation($e:String!,$p:String!){
  login(email:$e,password:$p){accessToken errors{code}}}"""
ME = "{ me { email } }"
REFRESH = "mutation { refreshToken { accessToken errors{code} } }"
PW = "correct-horse-battery"


def register(client, email="a@example.com"):
    return gql(client, REGISTER, {"e": email, "p": PW, "n": "Ann"})["data"]["register"]


def test_register_returns_token_user_and_cookie(client):
    result = register(client)
    assert result["errors"] == [] and result["accessToken"]
    assert result["user"]["email"] == "a@example.com"
    assert result["user"]["onboarded"] is False
    assert client.cookies.get("refresh_token")


def test_register_rejects_duplicate_and_short_password(client):
    register(client)
    dup = register(client)
    assert dup["errors"][0]["code"] == "EMAIL_TAKEN"
    short = gql(client, REGISTER, {"e": "b@example.com", "p": "short", "n": "B"})
    assert short["data"]["register"]["errors"][0]["code"] == "PASSWORD_TOO_SHORT"


def test_login_wrong_password_and_unknown_email_look_identical(client):
    register(client)
    bad_pw = gql(client, LOGIN, {"e": "a@example.com", "p": "wrong-password-1"})
    unknown = gql(client, LOGIN, {"e": "nobody@example.com", "p": "wrong-password-1"})
    assert bad_pw["data"]["login"]["errors"] == unknown["data"]["login"]["errors"]
    assert bad_pw["data"]["login"]["errors"][0]["code"] == "INVALID_CREDENTIALS"


def test_me_requires_a_valid_token(client):
    token = register(client)["accessToken"]
    assert gql(client, ME)["errors"][0]["extensions"]["code"] == "UNAUTHENTICATED"
    assert gql(client, ME, token=token)["data"]["me"]["email"] == "a@example.com"


def test_expired_access_token_is_rejected(client):
    user_id = int(jwt.decode(register(client)["accessToken"],
                             options={"verify_signature": False})["sub"])
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    expired = jwt.encode({"sub": str(user_id), "type": "access", "exp": past},
                         auth.JWT_SECRET, algorithm="HS256")
    assert gql(client, ME, token=expired)["errors"][0]["extensions"]["code"] == "UNAUTHENTICATED"


def test_refresh_rotates_the_cookie(client):
    register(client)
    old = client.cookies.get("refresh_token")
    result = gql(client, REFRESH)["data"]["refreshToken"]
    assert result["accessToken"]
    assert client.cookies.get("refresh_token") != old


def test_refresh_without_custom_header_is_rejected(client):
    register(client)
    r = client.post("/graphql", json={"query": REFRESH}).json()
    assert r["errors"][0]["extensions"]["code"] == "UNAUTHENTICATED"


def test_reusing_a_rotated_token_revokes_the_whole_family(db):
    user = auth.register_user(db, "c@example.com", PW, "Cy")
    first = auth.issue_refresh_token(db, user.id)
    db.commit()
    _, second = auth.rotate_refresh_token(db, first)      # legitimate rotation
    with pytest.raises(auth.AuthError):
        auth.rotate_refresh_token(db, first)               # attacker replays the old one
    with pytest.raises(auth.AuthError):
        auth.rotate_refresh_token(db, second)              # family is now dead


def test_logout_revokes_the_refresh_token(client, db):
    register(client)
    raw = client.cookies.get("refresh_token")
    assert gql(client, "mutation { logout }")["data"]["logout"] is True
    with pytest.raises(auth.AuthError):
        auth.rotate_refresh_token(db, raw)