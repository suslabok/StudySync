// src/graphql/tasks.ts
import { gql } from "@apollo/client";

const TASK_FIELDS = gql`
  fragment TaskFields on Task {
    id title notes status dueDate completedAt assigned assignmentId
    course { id code color }
  }
`;

const ASSIGNMENT_FIELDS = gql`
  fragment AssignmentFields on Assignment {
    id title notes dueDate createdAt canEdit doneCount total myTaskId myStatus
    author { id displayName }
  }
`;

const ERRORS = "errors { field code message }";

export const TASKS = gql`query Tasks { tasks { ...TaskFields } } ${TASK_FIELDS}`;
export const DUE_SOON = gql`query DueSoon { dueSoon(days: 7, limit: 5) { ...TaskFields } } ${TASK_FIELDS}`;
export const ASSIGNMENTS = gql`
  query Assignments($courseId: ID!) { assignments(courseId: $courseId) { ...AssignmentFields } }
  ${ASSIGNMENT_FIELDS}
`;

export const CREATE_TASK = gql`
  mutation CreateTask($input: TaskInput!) { createTask(input: $input) { task { ...TaskFields } ${ERRORS} } }
  ${TASK_FIELDS}
`;
export const UPDATE_TASK = gql`
  mutation UpdateTask($id: ID!, $input: TaskInput!) { updateTask(id: $id, input: $input) { task { ...TaskFields } ${ERRORS} } }
  ${TASK_FIELDS}
`;
export const SET_TASK_STATUS = gql`
  mutation SetTaskStatus($id: ID!, $status: String!) { setTaskStatus(id: $id, status: $status) { task { ...TaskFields } ${ERRORS} } }
  ${TASK_FIELDS}
`;
export const DELETE_TASK = gql`mutation DeleteTask($id: ID!) { deleteTask(id: $id) { ok ${ERRORS} } }`;

export const CREATE_ASSIGNMENT = gql`
  mutation CreateAssignment($courseId: ID!, $input: AssignmentInput!) {
    createAssignment(courseId: $courseId, input: $input) { assignment { ...AssignmentFields } ${ERRORS} }
  }
  ${ASSIGNMENT_FIELDS}
`;
export const UPDATE_ASSIGNMENT = gql`
  mutation UpdateAssignment($id: ID!, $input: AssignmentInput!) {
    updateAssignment(id: $id, input: $input) { assignment { ...AssignmentFields } ${ERRORS} }
  }
  ${ASSIGNMENT_FIELDS}
`;
export const DELETE_ASSIGNMENT = gql`mutation DeleteAssignment($id: ID!) { deleteAssignment(id: $id) { ok ${ERRORS} } }`;

export type TaskStatus = "todo" | "doing" | "done";

export type Task = {
  id: string; title: string; notes: string | null; status: TaskStatus;
  dueDate: string | null; completedAt: string | null; assigned: boolean; assignmentId: string | null;
  course: { id: string; code: string; color: string } | null;
};

export type Assignment = {
  id: string; title: string; notes: string | null; dueDate: string | null;
  createdAt: string; canEdit: boolean; doneCount: number | null; total: number | null;
  myTaskId: string | null; myStatus: TaskStatus | null; author: { id: string; displayName: string };
};

export type TasksData = { tasks: Task[] };
export type DueSoonData = { dueSoon: Task[] };
export type AssignmentsData = { assignments: Assignment[] };

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const isPastDue = (iso: string | null) => !!iso && iso < todayIso();
export const isOverdue = (t: { status: string; dueDate: string | null }) => t.status !== "done" && isPastDue(t.dueDate);

export function dueLabel(iso: string | null) {
  if (!iso) return "No due date";
  const days = Math.round((new Date(`${iso}T00:00:00`).getTime() - new Date(`${todayIso()}T00:00:00`).getTime()) / 86_400_000);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days === -1) return "1 day overdue";
  if (days < 0) return `${-days} days overdue`;
  if (days < 7) return `Due in ${days} days`;
  return `Due ${new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}