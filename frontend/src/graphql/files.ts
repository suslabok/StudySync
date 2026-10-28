import { gql } from "@apollo/client";

export const MAX_FILE_MB = 5; // keep in step with MAX_UPLOAD_MB on the server

export type FileParent = "TASK" | "ASSIGNMENT";
export type FileInfo = { id: string; name: string; mimeType: string; sizeBytes: number; canDelete: boolean };
export type TaskWork = { taskId: string; status: string; assigned: boolean; answer: string | null; submittedAt: string | null };
export type Submission = {
  taskId: string;
  student: { id: string; displayName: string; avatarUrl: string | null };
  status: string;
  submittedAt: string | null;
  answer: string | null;
  files: FileInfo[];
};

const FILE_FIELDS = "id name mimeType sizeBytes canDelete";

export const FILES = gql(`query Files($kind: FileParent!, $parentId: ID!) {
  files(kind: $kind, parentId: $parentId) { ${FILE_FIELDS} }
}`);

export const FILE_CONTENT = gql`
  query FileContent($id: ID!) { fileContent(id: $id) { name mimeType content } }
`;

export const ATTACH_FILE = gql(`mutation AttachFile($kind: FileParent!, $parentId: ID!, $name: String!, $content: String!) {
  attachFile(kind: $kind, parentId: $parentId, name: $name, content: $content) {
    file { ${FILE_FIELDS} }
    errors { field code message }
  }
}`);

export const DELETE_FILE = gql`
  mutation DeleteFile($id: ID!) { deleteFile(id: $id) { ok errors { field code message } } }
`;

export const TASK_WORK = gql`
  query TaskWork($taskId: ID!) { taskWork(taskId: $taskId) { taskId status assigned answer submittedAt } }
`;

export const SAVE_WORK = gql`
  mutation SaveWork($taskId: ID!, $answer: String, $submit: Boolean) {
    saveWork(taskId: $taskId, answer: $answer, submit: $submit) {
      work { taskId status assigned answer submittedAt }
      errors { field code message }
    }
  }
`;

export const SUBMISSIONS = gql(`query Submissions($assignmentId: ID!) {
  submissions(assignmentId: $assignmentId) {
    taskId status submittedAt answer
    student { id displayName avatarUrl }
    files { ${FILE_FIELDS} }
  }
}`);

/** Like CREATE_ASSIGNMENT but also returns the new id, so files picked in the form can be uploaded to it. */
export const CREATE_ASSIGNMENT_FULL = gql`
  mutation CreateAssignmentFull($courseId: ID!, $input: AssignmentInput!) {
    createAssignment(courseId: $courseId, input: $input) {
      assignment { id }
      errors { field code message }
    }
  }
`;

// ---- courses and semesters (edit and delete) ----

export const UPDATE_COURSE = gql`
  mutation UpdateCourse($id: ID!, $code: String!, $title: String!, $color: String) {
    updateCourse(id: $id, code: $code, title: $title, color: $color) {
      course { id code title color }
      errors { field code message }
    }
  }
`;

export const DELETE_SEMESTER = gql`
  mutation DeleteSemester($id: ID!) { deleteSemester(id: $id) }
`;