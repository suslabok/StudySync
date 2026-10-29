// src/graphql/taskFiles.ts
import { gql } from "@apollo/client";

const FILE = "id name mimeType sizeBytes canDelete";
const ERRORS = "errors { field code message }";

export const FILES = gql`query Files($kind: FileParent!, $parentId: ID!) { files(kind: $kind, parentId: $parentId) { ${FILE} } }`;
export const FILE_CONTENT = gql`query FileContent($id: ID!) { fileContent(id: $id) { name mimeType content } }`;
export const ATTACH_FILE = gql`
  mutation AttachFile($kind: FileParent!, $parentId: ID!, $name: String!, $content: String!) {
    attachFile(kind: $kind, parentId: $parentId, name: $name, content: $content) { file { ${FILE} } ${ERRORS} }
  }
`;
export const DELETE_FILE = gql`mutation DeleteFile($id: ID!) { deleteFile(id: $id) { ok ${ERRORS} } }`;

export const TASK_WORK = gql`query TaskWork($taskId: ID!) { taskWork(taskId: $taskId) { taskId status assigned answer submittedAt } }`;
export const SAVE_WORK = gql`
  mutation SaveWork($taskId: ID!, $answer: String, $submit: Boolean, $unsubmit: Boolean) {
    saveWork(taskId: $taskId, answer: $answer, submit: $submit, unsubmit: $unsubmit) {
      work { taskId status assigned answer submittedAt } ${ERRORS}
    }
  }
`;
export const SUBMISSIONS = gql`
  query Submissions($assignmentId: ID!) {
    submissions(assignmentId: $assignmentId) {
      taskId status submittedAt answer
      student { id displayName avatarUrl }
      files { ${FILE} }
    }
  }
`;

export type FileInfo = { id: string; name: string; mimeType: string; sizeBytes: number; canDelete: boolean };
export type TaskWork = { taskId: string; status: string; assigned: boolean; answer: string | null; submittedAt: string | null };
export type Submission = {
  taskId: string; status: string; submittedAt: string | null; answer: string | null;
  student: { id: string; displayName: string; avatarUrl: string | null }; files: FileInfo[];
};

export const MAX_MB = 5;
export const MAX_FILES = 10;
export const ACCEPT = ".pdf,.png,.jpg,.jpeg,.txt,.md,.csv,.zip,.docx,.pptx,.xlsx";
export const FILE_HINT = `Up to ${MAX_MB} MB each: PDF, images, text, Office files, ZIP`;

export const fmtSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** A message if the picked files can't be used (the server checks again), otherwise null. */
export function checkPicked(files: File[], alreadyThere = 0): string | null {
  if (alreadyThere + files.length > MAX_FILES) return `You can attach up to ${MAX_FILES} files here.`;
  const big = files.find((f) => f.size > MAX_MB * 1024 * 1024);
  return big ? `"${big.name}" is over ${MAX_MB} MB.` : null;
}

export const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

export function saveBlob(name: string, mimeType: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
