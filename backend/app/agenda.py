"""Calendar extras: public holidays for a country, and the user's own events (exams, breaks, ...).

Public holidays come from the `holidays` package (pip install holidays): it works offline, covers
~500 countries/regions, and includes the lunar-calendar ones (Nepal, India, ...). Own events live in
the `event` table. Register in api.py: agenda.type_defs, agenda.query, agenda.mutation.
"""
from datetime import date
from functools import lru_cache

import holidays as holidays_lib
from ariadne import MutationType, QueryType
from graphql import GraphQLError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Event, User
from app.schema import current_user

KINDS = ("event", "exam", "break")
YEARS = range(1990, 2101)


class AgendaError(Exception):
    def __init__(self, field: str | None, code: str, message: str):
        super().__init__(message)
        self.field, self.code, self.message = field, code, message


# ---------------- public holidays ----------------

@lru_cache(maxsize=1)
def countries() -> list[str]:
    return sorted(holidays_lib.list_supported_countries())


LANGUAGES = ("en_US", "ne")           # English, or Nepali script (falls back to the country's default)


@lru_cache(maxsize=512)
def _holidays(country: str, year: int, language: str) -> tuple[tuple[date, str], ...]:
    try:
        found = holidays_lib.country_holidays(country, years=year, language=language)
    except (NotImplementedError, ValueError):
        found = holidays_lib.country_holidays(country, years=year)     # that language isn't available here
    return tuple(sorted(found.items()))


def list_holidays(country: str, year: int, language: str = "en_US") -> list[dict]:
    country = (country or "").strip().upper()
    if country not in countries():
        raise AgendaError("country", "INVALID", "Unknown country.")
    if year not in YEARS:
        raise AgendaError("year", "INVALID", "Year out of range.")
    if language not in LANGUAGES:
        language = "en_US"
    return [{"date": d, "name": n} for d, n in _holidays(country, year, language)]


# ---------------- own events ----------------

def _clean(data: dict) -> dict:
    title = (data.get("title") or "").strip()
    if not title:
        raise AgendaError("title", "REQUIRED", "Give the event a title.")
    if len(title) > 200:
        raise AgendaError("title", "TOO_LONG", "Keep the title under 200 characters.")
    kind = data.get("kind") or "event"
    if kind not in KINDS:
        raise AgendaError("kind", "INVALID", "Unknown event type.")
    notes = (data.get("notes") or "").strip() or None
    if notes and len(notes) > 2000:
        raise AgendaError("notes", "TOO_LONG", "Keep the notes under 2000 characters.")
    start, end = data.get("start_date"), data.get("end_date")
    if start is None:
        raise AgendaError("startDate", "REQUIRED", "Pick a date.")
    if end is not None and end < start:
        raise AgendaError("endDate", "INVALID", "The end can't be before the start.")
    if end == start:
        end = None
    return {"title": title, "notes": notes, "kind": kind, "start_date": start, "end_date": end}


def _own(db: Session, user: User, event_id) -> Event:
    try:
        pk = int(event_id)
    except (TypeError, ValueError):
        raise AgendaError(None, "NOT_FOUND", "Event not found.")
    event = db.scalar(select(Event).where(Event.id == pk, Event.owner_id == user.id))
    if event is None:                                  # someone else's id looks like a missing one
        raise AgendaError(None, "NOT_FOUND", "Event not found.")
    return event


def list_events(db: Session, user: User, start: date, end: date) -> list[Event]:
    """Events that touch the range [start, end]."""
    last = Event.end_date
    return list(db.scalars(
        select(Event).where(
            Event.owner_id == user.id,
            Event.start_date <= end,
            or_(Event.start_date >= start, last >= start),
        ).order_by(Event.start_date, Event.id)))


def create_event(db: Session, user: User, data: dict) -> Event:
    event = Event(owner_id=user.id, **_clean(data))
    db.add(event)
    db.commit()
    return event


def update_event(db: Session, user: User, event_id, data: dict) -> Event:
    event = _own(db, user, event_id)
    for key, value in _clean(data).items():
        setattr(event, key, value)
    db.commit()
    return event


def delete_event(db: Session, user: User, event_id) -> None:
    db.delete(_own(db, user, event_id))
    db.commit()


# ---------------- GraphQL ----------------

type_defs = """
type Holiday { date: Date!, name: String! }
type CalendarEvent { id: ID!, title: String!, notes: String, kind: String!, startDate: Date!, endDate: Date }

input EventInput { title: String!, notes: String, kind: String!, startDate: Date!, endDate: Date }
type EventPayload { event: CalendarEvent, errors: [UserError!]! }
type EventDeletePayload { ok: Boolean!, errors: [UserError!]! }

extend type Query {
  holidayCountries: [String!]!
  holidays(country: String!, year: Int!, language: String = "en_US"): [Holiday!]!
  events(from: Date!, to: Date!): [CalendarEvent!]!
}

extend type Mutation {
  createEvent(input: EventInput!): EventPayload!
  updateEvent(id: ID!, input: EventInput!): EventPayload!
  deleteEvent(id: ID!): EventDeletePayload!
}
"""

query = QueryType()
mutation = MutationType()


def _read(info, fn):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            return fn(db, user)
        except AgendaError as e:
            raise GraphQLError(e.message, extensions={"code": e.code})


def _write(info, fn, key: str):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            result = fn(db, user)
        except AgendaError as e:
            db.rollback()
            return {key: False if key == "ok" else None,
                    "errors": [{"field": e.field, "code": e.code, "message": e.message}]}
        return {key: True if key == "ok" else result, "errors": []}


@query.field("holidayCountries")
def resolve_countries(_, info):
    return _read(info, lambda db, u: countries())


@query.field("holidays")
def resolve_holidays(_, info, country, year, language="en_US"):
    return _read(info, lambda db, u: list_holidays(country, year, language))


@query.field("events")
def resolve_events(_, info, **kw):
    return _read(info, lambda db, u: list_events(db, u, kw["from"], kw["to"]))


@mutation.field("createEvent")
def resolve_create(_, info, input):
    return _write(info, lambda db, u: create_event(db, u, input), "event")


@mutation.field("updateEvent")
def resolve_update(_, info, id, input):
    return _write(info, lambda db, u: update_event(db, u, id, input), "event")


@mutation.field("deleteEvent")
def resolve_delete(_, info, id):
    return _write(info, lambda db, u: delete_event(db, u, id), "ok")