import { useRef, useState, type ChangeEvent } from "react";
import { useApolloClient, useMutation, useQuery } from "@apollo/client/react";
import { Banner, Button, LoadError } from "./AppShell";
import Avatar from "./Avatar";
import {
  ATTACH_FILE, DELETE_FILE, FILES, FILE_CONTENT, MAX_FILE_MB, SAVE_WORK, SUBMISSIONS, TASK_WORK,
  type FileInfo, type FileParent, type Submission, type TaskWork,
} from "../graphql/files";
import { ASSIGNMENTS, DUE_SOON, TASKS } from "../graphql/tasks";

// ============ files: upload, list, download ============

export const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

const tooBig = (f: File) => f.size > MAX_FILE_MB * 1024 * 1024;

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Download an authorised file: the server checks access, then the browser saves the bytes. */
export function useDownload() {
  const client = useApolloClient();
  const [error, setError] = useState("");
  async function download(id: string) {
    setError("");
    try {
      const { data } = await client.query<any>({ query: FILE_CONTENT, variables: { id }, fetchPolicy: "no-cache" });
      const f = data.fileContent;
      const bytes = Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: f.mimeType }));
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error(e);
      setError("Could not download the file.");
    }
  }
  return { download, error };
}

/** Upload one file; resolves to an error message, or null on success. */
export function useUploader() {
  const [attach] = useMutation<any>(ATTACH_FILE, { refetchQueries: [FILES] });
  return async (kind: FileParent, parentId: string, file: File): Promise<string | null> => {
    if (tooBig(file)) return `${file.name} is larger than ${MAX_FILE_MB} MB.`;
    try {
      const content = await readBase64(file);
      const { data } = await attach({ variables: { kind, parentId, name: file.name, content } });
      return data?.attachFile.errors?.[0]?.message ?? null;
    } catch (e) {
      console.error(e);
      return `Could not upload ${file.name}.`;
    }
  };
}

/** A list of files with a Download button each, and a Remove button when `onRemove` is given. */
export function FileList({ files, onRemove, onDownload }: {
  files: FileInfo[];
  onDownload: (id: string) => void;
  onRemove?: (f: FileInfo) => void;
}) {
  if (files.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
          <span aria-hidden="true">📎</span>
          <span className="min-w-0 flex-1 truncate">{f.name} <span className="text-xs text-slate-400">{fmtSize(f.sizeBytes)}</span></span>
          <button type="button" onClick={() => onDownload(f.id)} className="text-xs font-medium text-plum-800 underline">Download</button>
          {onRemove && f.canDelete && (
            <button type="button" onClick={() => onRemove(f)} aria-label={`Remove ${f.name}`}
              className="text-xs text-red-600 hover:underline">Remove</button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Files attached to a task (the student's work) or to an assignment (the assigner's material). */
export function FileAttach({ kind, parentId, canEdit }: { kind: FileParent; parentId: string; canEdit: boolean }) {
  const { data, error, refetch } = useQuery<{ files: FileInfo[] }>(FILES, {
    variables: { kind, parentId }, fetchPolicy: "cache-and-network",
  });
  const upload = useUploader();
  const [remove] = useMutation<any>(DELETE_FILE, { refetchQueries: [FILES] });
  const { download, error: downloadError } = useDownload();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!picked.length) return;
    setBusy(true);
    setMessage("");
    for (const f of picked) {
      const err = await upload(kind, parentId, f);
      if (err) { setMessage(err); break; }
    }
    setBusy(false);
  }

  async function onRemove(f: FileInfo) {
    setMessage("");
    try {
      const { data: d } = await remove({ variables: { id: f.id } });
      const err = d?.deleteFile.errors?.[0];
      if (err) setMessage(err.message);
    } catch (e) {
      console.error(e);
      setMessage("Could not remove the file.");
    }
  }

  const files = data?.files ?? [];
  return (
    <div className="space-y-2">
      {error && !data ? (
        <p role="alert" className="text-sm text-red-700">
          Could not load files. <button type="button" onClick={() => refetch()} className="font-medium underline">Try again</button>
        </p>
      ) : files.length === 0 ? (
        <p className="text-sm text-slate-500">No files yet.</p>
      ) : (
        <FileList files={files} onDownload={download} onRemove={onRemove} />
      )}
      {canEdit && (
        <div>
          <input ref={input} type="file" multiple className="sr-only" onChange={onPick} aria-label="Choose files to attach" />
          <button type="button" disabled={busy} onClick={() => input.current?.click()}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
            {busy ? "Uploading…" : "Attach a file"}
          </button>
          <span className="ml-2 text-xs text-slate-400">Up to {MAX_FILE_MB} MB each: PDF, images, text, Office files, ZIP</span>
        </div>
      )}
      {(message || downloadError) && <p role="alert" className="text-xs text-red-600">{message || downloadError}</p>}
    </div>
  );
}

/** File chooser for a form whose parent doesn't exist yet. The parent uploads the files after saving. */
export function FilePicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    const big = picked.filter(tooBig);
    setMessage(big.length ? `${big.map((f) => f.name).join(", ")} is larger than ${MAX_FILE_MB} MB and was skipped.` : "");
    onChange([...files, ...picked.filter((f) => !tooBig(f))].slice(0, 10));
  }

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">Files <span className="text-slate-400">(optional)</span></span>
      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
              <span aria-hidden="true">📎</span>
              <span className="min-w-0 flex-1 truncate">{f.name} <span className="text-xs text-slate-400">{fmtSize(f.size)}</span></span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="text-xs text-red-600 hover:underline">Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <input ref={input} type="file" multiple className="sr-only" onChange={onPick} aria-label="Choose files to attach" />
        <button type="button" onClick={() => input.current?.click()}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">Choose files</button>
        <span className="ml-2 text-xs text-slate-400">Up to {MAX_FILE_MB} MB each</span>
      </div>
      {message && <p role="alert" className="text-xs text-red-600">{message}</p>}
    </div>
  );
}

// ============ a student's work, and what the assigner sees ============

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** A student's own work on one task: a written answer and/or files, then Submit. */
export function TaskWorkPanel({ taskId }: { taskId: string }) {
  const { data, error, refetch } = useQuery<{ taskWork: TaskWork }>(TASK_WORK, {
    variables: { taskId }, fetchPolicy: "cache-and-network",
  });
  const [save, { loading }] = useMutation<any>(SAVE_WORK, {
    refetchQueries: [TASK_WORK, TASKS, DUE_SOON, ASSIGNMENTS],
  });
  const [draft, setDraft] = useState<string | null>(null); // null = untouched, show the saved answer
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  const work = data?.taskWork;
  if (error && !work) return <LoadError what="work" onRetry={() => refetch()} />;
  if (!work) return <p className="text-sm text-slate-500">Loading…</p>;

  const text = draft ?? work.answer ?? "";

  async function send(submit: boolean) {
    setMessage(null);
    try {
      const { data: d } = await save({ variables: { taskId, answer: text, submit } });
      const err = d?.saveWork.errors?.[0];
      if (err) return setMessage({ kind: "error", text: err.message });
      setDraft(null);
      setMessage({ kind: "ok", text: submit ? "Submitted." : "Draft saved." });
    } catch (e) {
      console.error(e);
      setMessage({ kind: "error", text: "Something went wrong. Please try again." });
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
      {work.submittedAt && (
        <p className="text-sm font-medium text-green-800">Submitted {when(work.submittedAt)}. You can change it and submit again.</p>
      )}
      <div>
        <label htmlFor={`answer-${taskId}`} className="text-sm font-medium">Your answer</label>
        <textarea id={`answer-${taskId}`} rows={4} value={text} onChange={(e) => setDraft(e.target.value)}
          placeholder="Write your answer here, or attach a file below."
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-plum-800 focus:outline-none focus:ring-2 focus:ring-sun-400" />
      </div>
      <div>
        <p className="mb-1 text-sm font-medium">Your files</p>
        <FileAttach kind="TASK" parentId={taskId} canEdit />
      </div>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      <div className="flex gap-2">
        <Button type="button" disabled={loading} onClick={() => send(true)}>{work.submittedAt ? "Update submission" : "Submit"}</Button>
        <Button type="button" variant="secondary" disabled={loading} onClick={() => send(false)}>Save draft</Button>
      </div>
    </div>
  );
}

/** What the people who received an assignment have handed in. Only the assigner sees this. */
export function Submissions({ assignmentId }: { assignmentId: string }) {
  const { data, error, refetch } = useQuery<{ submissions: Submission[] }>(SUBMISSIONS, {
    variables: { assignmentId }, fetchPolicy: "cache-and-network",
  });
  const { download, error: downloadError } = useDownload();

  if (error && !data) return <LoadError what="submissions" onRetry={() => refetch()} />;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  if (data.submissions.length === 0) return <p className="text-sm text-slate-500">Nobody has received this yet.</p>;

  const handedIn = data.submissions.filter((s) => s.submittedAt).length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{handedIn} of {data.submissions.length} handed in</p>
      <ul className="space-y-2">
        {data.submissions.map((s) => (
          <li key={s.taskId} className="rounded-xl border border-slate-100 bg-white p-3">
            <div className="flex items-center gap-2">
              <Avatar name={s.student.displayName} url={s.student.avatarUrl} size={28} />
              <p className="min-w-0 flex-1 truncate text-sm font-semibold">{s.student.displayName}</p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                s.submittedAt ? "bg-green-50 text-green-800" : "bg-slate-100 text-slate-600"}`}>
                {s.submittedAt ? `Submitted ${when(s.submittedAt)}` : s.status === "doing" ? "In progress" : "Not submitted"}
              </span>
            </div>
            {s.answer && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-medium text-plum-800">Written answer</summary>
                <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{s.answer}</p>
              </details>
            )}
            {s.files.length > 0 && <div className="mt-2"><FileList files={s.files} onDownload={download} /></div>}
          </li>
        ))}
      </ul>
      {downloadError && <p role="alert" className="text-xs text-red-600">{downloadError}</p>}
    </div>
  );
}