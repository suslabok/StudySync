import os

# must be set before importing the app
os.environ["DATABASE_URL"] = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://studysync:change-me@localhost:5432/studysync_test")
os.environ["JWT_SECRET_KEY"] = "test-secret-key-test-secret-key-1234"

import pytest
from sqlalchemy import text
from starlette.testclient import TestClient

from app import models  # noqa: F401
from app.database import Base, SessionLocal, engine
from app.main import app


@pytest.fixture(scope="session", autouse=True)
def _schema():
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def _clean():
    with engine.begin() as conn:
        conn.execute(text('TRUNCATE "user", refresh_token RESTART IDENTITY CASCADE'))


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client():
    return TestClient(app)


def gql(client, query, variables=None, token=None):
    headers = {"X-Requested-With": "studysync"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return client.post("/graphql", json={"query": query, "variables": variables or {}},
                       headers=headers).json()