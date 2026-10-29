from datetime import date

from ariadne import MutationType, QueryType, ScalarType
from graphql import GraphQLError

from app import courses as svc
from app.courses import ApiError
from app.database import SessionLocal
from app.schema import current_user

type_defs = """
scalar Date

type Course { id: ID!, code: String!, title: String!, color: String!}
type Semester { id: ID!, name: String!, startDate: Date!, endDate: Date!, isCurrent: Boolean!, courses: [Course!]! }
type Dashboard { currentSemester: Semester, courses: [Course!]! }

type SemesterPayload { semester: Semester, errors: [UserError!]! }
type CoursePayload { course: Course, errors: [UserError!]! }

extend type Query {
  semesters: [Semester!]!
  dashboard: Dashboard!
}

extend type Mutation {
  createSemester(name: String!, startDate: Date!, endDate: Date!): SemesterPayload!
  updateSemester(id: ID!, name: String!, startDate: Date!, endDate: Date!): SemesterPayload!
  createCourse(code: String!, title: String!, color: String!): CoursePayload!
  updateCourse(id: ID!, code: String!, title: String!, color: String): CoursePayload!
  deleteCourse(id: ID!): Boolean!
  deleteSemester(id: ID!): Boolean!
}
"""

query, mutation, date_scalar = QueryType(), MutationType(), ScalarType("Date")


@date_scalar.serializer
def serialize_date(value: date) -> str:
    return value.isoformat()


@date_scalar.value_parser
def parse_date(value: str) -> date:
    return date.fromisoformat(value)


def _errors(e: ApiError) -> list[dict]:
    return [{"field": e.field, "code": e.code, "message": e.message}]


@query.field("semesters")
def resolve_semesters(_, info):
    with SessionLocal() as db:
        user = current_user(info, db)
        return svc.list_semesters(db, user.id)


@query.field("dashboard")
def resolve_dashboard(_, info):
    with SessionLocal() as db:
        user = current_user(info, db)
        semester = svc.current_semester(db, user.id)
        return {"current_semester": semester, "courses": list(semester.courses) if semester else []}


@mutation.field("createSemester")
def resolve_create_semester(_, info, name, start_date, end_date):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            semester = svc.create_semester(db, user.id, name, start_date, end_date)
        except ApiError as e:
            return {"semester": None, "errors": _errors(e)}
        return {"semester": semester, "errors": []}


@mutation.field("updateSemester")
def resolve_update_semester(_, info, id, name, start_date, end_date):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            semester = svc.update_semester(db, user.id, id, name, start_date, end_date)
        except ApiError as e:
            return {"semester": None, "errors": _errors(e)}
        return {"semester": semester, "errors": []}


@mutation.field("createCourse")
def resolve_create_course(_, info, code, title, color=None):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            course = svc.create_course(db, user.id, code, title, color)
        except ApiError as e:
            return {"course": None, "errors": _errors(e)}
        return {"course": course, "errors": []}


@mutation.field("updateCourse")
def resolve_update_course(_, info, id, code, title, color=None):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            course = svc.update_course(db, user.id, id, code, title, color)
        except ApiError as e:
            return {"course": None, "errors": _errors(e)}
        return {"course": course, "errors": []}


@mutation.field("deleteCourse")
def resolve_delete_course(_, info, id):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            svc.delete_course(db, user.id, id)
        except ApiError as e:
            raise GraphQLError(e.message, extensions={"code": e.code})
        return True


@mutation.field("deleteSemester")
def resolve_delete_semester(_, info, id):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            svc.delete_semester(db, user.id, id)
        except ApiError as e:
            raise GraphQLError(e.message, extensions={"code": e.code})
        return True