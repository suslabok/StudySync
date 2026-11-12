"""Prepares the database when the server starts (the Dockerfile runs this before uvicorn).

* Empty database  -> create every table from the models, add the search indexes, and tell Alembic
                     that all migrations are already applied ("stamp head").
* Existing database -> apply any new migrations (alembic upgrade head), as before.

Why: the oldest migrations assume tables (such as "task") that were created outside Alembic, so they
cannot build a database from nothing. Building from the models gives the same final result.
"""
import importlib

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from app.database import Base, engine
import app.models  # noqa: F401  (registers the core tables)

for _extra in ("study_models", "meeting_models", "reset_models"):
    try:
        importlib.import_module(f"app.{_extra}")
    except ImportError:
        pass

# Same expressions as the "search indexes" migration and search.py's vector().
FTS = {
    "ix_task_fts": ("task", "coalesce(title, '') || ' ' || coalesce(notes, '')"),
    "ix_assignment_fts": ("assignment", "coalesce(title, '') || ' ' || coalesce(notes, '')"),
    "ix_post_fts": ("post", "coalesce(body, '')"),
    "ix_comment_fts": ("comment", "coalesce(body, '')"),
}


def main() -> None:
    cfg = Config("alembic.ini")
    insp = inspect(engine)
    if insp.has_table("alembic_version") or insp.has_table("user"):
        print("[db] existing database: running migrations")
        command.upgrade(cfg, "head")
        return
    print("[db] empty database: creating tables from the models")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        for name, (table, expr) in FTS.items():
            conn.execute(text(
                f"CREATE INDEX IF NOT EXISTS {name} ON \"{table}\" USING gin (to_tsvector('english', {expr}))"))
    command.stamp(cfg, "head")
    print("[db] done")


if __name__ == "__main__":
    main()
