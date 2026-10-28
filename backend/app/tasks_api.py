from ariadne import MutationType, ObjectType, QueryType

from app import tasks as svc
from app.database import SessionLocal
from app.schema import current_user

type_defs = """
type Task {
  id: ID!
  title: String!
  notes: String
  status: String!
  priority: Int!
  dueDate: Date
  completedAt: String
  assigned: Boolean!
  course: Course
}

input TaskInput { title: String!, notes: String, priority: Int!, dueDate: Date, courseId: ID }
input AssignmentInput { title: String!, notes: String, priority: Int!, dueDate: Date }

type Assignment {
  id: ID!
  title: String!
  notes: String
  priority: Int!
  dueDate: Date
  createdAt: String!
  author: Person!
  canEdit: Boolean!
  doneCount: Int
  total: Int
  myTaskId: ID
  myStatus: String
}

type TaskPayload { task: Task, errors: [UserError!]! }
type AssignmentPayload { assignment: Assignment, errors: [UserError!]! }

extend type Query {
  tasks(status: String, courseId: ID): [Task!]!
  dueSoon(days: Int = 7, limit: Int = 5): [Task!]!
  assignments(courseId: ID!): [Assignment!]!
}

extend type Mutation {
  createTask(input: TaskInput!): TaskPayload!
  updateTask(id: ID!, input: TaskInput!): TaskPayload!
  setTaskStatus(id: ID!, status: String!): TaskPayload!
  deleteTask(id: ID!): OkPayload!
  createAssignment(courseId: ID!, input: AssignmentInput!): AssignmentPayload!
  updateAssignment(id: ID!, input: AssignmentInput!): AssignmentPayload!
  deleteAssignment(id: ID!): OkPayload!
}
"""

query = QueryType()
mutation = MutationType()
task_type = ObjectType("Task")


@task_type.field("completedAt")
def resolve_completed_at(task, _):
    return task.completed_at.isoformat() if task.completed_at else None


@task_type.field("assigned")
def resolve_assigned(task, _):
    return task.assignment_id is not None


def _errors(e: svc.TaskError) -> list[dict]:
    return [{"field": e.field, "code": e.code, "message": e.message}]


@query.field("tasks")
def resolve_tasks(_, info, status=None, course_id=None):
    with SessionLocal() as db:
        return svc.list_tasks(db, current_user(info, db), status, course_id)


@query.field("dueSoon")
def resolve_due_soon(_, info, days=7, limit=5):
    with SessionLocal() as db:
        return svc.due_soon(db, current_user(info, db), days, limit)


@query.field("assignments")
def resolve_assignments(_, info, course_id):
    with SessionLocal() as db:
        try:
            return svc.list_assignments(db, current_user(info, db), course_id)
        except svc.TaskError:
            return []


def _run(info, fn, key: str):
    """key 'task' / 'assignment' returns the object; key 'ok' returns True."""
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            result = fn(db, user)
        except svc.TaskError as e:
            db.rollback()
            return {key: False if key == "ok" else None, "errors": _errors(e)}
        return {key: True if key == "ok" else result, "errors": []}


@mutation.field("createTask")
def resolve_create(_, info, input):
    return _run(info, lambda db, u: svc.create_task(db, u, input), "task")


@mutation.field("updateTask")
def resolve_update(_, info, id, input):
    return _run(info, lambda db, u: svc.update_task(db, u, id, input), "task")


@mutation.field("setTaskStatus")
def resolve_status(_, info, id, status):
    return _run(info, lambda db, u: svc.set_status(db, u, id, status), "task")


@mutation.field("deleteTask")
def resolve_delete(_, info, id):
    return _run(info, lambda db, u: svc.delete_task(db, u, id), "ok")


@mutation.field("createAssignment")
def resolve_create_assignment(_, info, course_id, input):
    return _run(info, lambda db, u: svc.create_assignment(db, u, course_id, input), "assignment")


@mutation.field("updateAssignment")
def resolve_update_assignment(_, info, id, input):
    return _run(info, lambda db, u: svc.update_assignment(db, u, id, input), "assignment")


@mutation.field("deleteAssignment")
def resolve_delete_assignment(_, info, id):
    return _run(info, lambda db, u: svc.delete_assignment(db, u, id), "ok")