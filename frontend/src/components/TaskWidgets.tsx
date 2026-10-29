import { useRef, useState, type FormEvent } from "react";
import { useApolloClient, useMutation, useQuery } from "@apollo/client/react";
import { Button, Card, fieldCls } from "./AppShell";
import Avatar from "./Avatar";
import { DASHBOARD, type DashboardData } from "../graphql/dashboard";
import {
  ACCEPT, ATTACH_FILE, DELETE_FILE, FILES, FILE_CONTENT, FILE_HINT, SAVE_WORK, SUBMISSIONS, TASK_WORK,
  checkPicked, fmtSize, saveBlob, toBase64,
  type FileInfo, type Submission, type TaskWork,
} from "../graphql/taskFiles";
import {
  ASSIGNMENTS, CREATE_ASSIGNMENT, CREATE_TASK, DELETE_ASSIGNMENT, DUE_SOON,
  TASKS, UPDATE_ASSIGNMENT, UPDATE_TASK, dueLabel, isPastDue,
  type Assignment, type AssignmentsData, type Task,
} from "../graphql/tasks";

type Props = {
  task?: Task;              // edit a personal task
  assignment?: Assignment;  // edit a course assignment
  assignTo?: string;        // create a course assignment on this (own) course id
  defaultDue?: string;      // pre-fill the due date of a new task (YYYY-MM-DD)
  onDone: () => void;
};

/** One form for personal tasks and course assignments. Assignments have no course picker. */
export function TaskForm({ task, assignment, assignTo, defaultDue, onDone }: Props) {
  const assigning = !!assignTo || !!assignment;
  const existing = task ?? assignment;
  const { data } = useQuery<DashboardData>(DASHBOARD, { fetchPolicy: "cache-first", skip: assigning });
  const courses = data?.dashboard.courses ?? [];
  const [title, setTitle] = useState(existing?.title ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? defaultDue ?? "");
  const [courseId, setCourseId] = useState(task?.course?.id ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [staged, setStaged] = useState<File[]>([]);   // files chosen before the task/assignment exists
  const [created, setCreated] = useState(false);       // saved, but some upload failed: don't save twice
  const [attach] = useMutation<any>(ATTACH_FILE, { refetchQueries: [FILES] });

  const refetchQueries = [TASKS, DUE_SOON, ASSIGNMENTS];
  const [createTask, c1] = useMutation<any>(CREATE_TASK, { refetchQueries });
  const [updateTask, c2] = useMutation<any>(UPDATE_TASK, { refetchQueries });
  const [createAssignment, c3] = useMutation<any>(CREATE_ASSIGNMENT, { refetchQueries });
  const [updateAssignment, c4] = useMutation<any>(UPDATE_ASSIGNMENT, { refetchQueries });
  const [uploading, setUploading] = useState(false);
  const busy = c1.loading || c2.loading || c3.loading || c4.loading || uploading;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    const input = { title, notes: notes || null, dueDate: dueDate || null };
    let payload;
    if (assignment) payload = (await updateAssignment({ variables: { id: assignment.id, input } })).data?.updateAssignment;
    else if (assignTo) payload = (await createAssignment({ variables: { courseId: assignTo, input } })).data?.createAssignment;
    else if (task) payload = (await updateTask({ variables: { id: task.id, input: { ...input, courseId: courseId || null } } })).data?.updateTask;
    else payload = (await createTask({ variables: { input: { ...input, courseId: courseId || null } } })).data?.createTask;
    if (payload?.errors?.length) {
      const next: Record<string, string> = {};
      for (const er of payload.errors) next[er.field ?? "form"] = er.message;
      return setErrors(next);
    }

    // upload the chosen files to what was just saved
    const saved = payload?.assignment ?? payload?.task;
    if (saved && staged.length) {
      setUploading(true);
      const kind = payload.assignment ? "ASSIGNMENT" : "TASK";
      for (const file of staged) {
        let problem = "";
        try {
          const { data: res } = await attach({ variables: { kind, parentId: saved.id, name: file.name, content: await toBase64(file) } });
          problem = res?.attachFile.errors[0]?.message ?? "";
        } catch {
          problem = "Could not upload the file.";
        }
        if (problem) {
          setUploading(false);
          setCreated(true);
          return setErrors({ form: `Saved, but ${file.name} was not uploaded: ${problem} You can add it by editing.` });
        }
      }
      setUploading(false);
    }
    onDone();
  }

  function pickFiles(list: File[]) {
    const problem = checkPicked(list, staged.length);
    if (problem) return setErrors({ files: problem });
    setErrors({});
    setStaged((all) => [...all, ...list]);
  }

  const err = (k: string) => errors[k] && <p className="mt-1 text-xs text-red-600">{errors[k]}</p>;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="t-title" className="text-sm font-medium">{assigning ? "Assignment title" : "Title"}</label>
        <input id="t-title" className={fieldCls} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        {err("title")}
      </div>
      <div>
        <label htmlFor="t-notes" className="text-sm font-medium">{assigning ? "Instructions" : "Notes"} <span className="text-slate-400">(optional)</span></label>
        <textarea id="t-notes" rows={2} className={fieldCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {err("notes")}
      </div>
      <div className={`grid gap-4 ${assigning ? "" : "sm:grid-cols-2"}`}>
        {!assigning && (
          <div>
            <label htmlFor="t-course" className="text-sm font-medium">Course</label>
            <select id="t-course" className={fieldCls} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">None (personal)</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
            </select>
            {err("courseId")}
          </div>
        )}
        <div>
          <label htmlFor="t-due" className="text-sm font-medium">Due date</label>
          <input id="t-due" type="date" className={fieldCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          {err("dueDate")}
        </div>
      </div>

      {existing ? (
        // already saved: attach and remove straight away
        <ParentFiles kind={assignment ? "ASSIGNMENT" : "TASK"} parentId={existing.id} title="Files" canAttach />
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium">Files <span className="text-slate-400">(optional)</span></p>
          {staged.length > 0 && (
            <ul className="space-y-1.5">
              {staged.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-1.5 text-sm">
                  <span aria-hidden="true">📎</span>
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">{fmtSize(f.size)}</span>
                  <button type="button" onClick={() => setStaged((all) => all.filter((_, j) => j !== i))}
                    className="shrink-0 text-xs font-medium text-red-600 underline">Remove</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <AttachButton onPick={pickFiles} disabled={busy || created} />
            <span className="text-xs text-slate-400">{FILE_HINT}</span>
          </div>
          {err("files")}
        </div>
      )}
      {err("form")}
      <div className="flex gap-2">
        <Button disabled={busy || created}>{busy ? "Saving…" : assignment || task ? "Save changes" : assigning ? "Assign" : "Add task"}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>{created ? "Close" : "Cancel"}</Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* files                                                              */
/* ------------------------------------------------------------------ */

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Downloads a file the signed-in user may read. */
export function useDownload() {
  const client = useApolloClient();
  return async (file: { id: string }) => {
    try {
      const { data } = await client.query<{ fileContent: { name: string; mimeType: string; content: string } }>({
        query: FILE_CONTENT, variables: { id: file.id }, fetchPolicy: "no-cache",
      });
      if (data) saveBlob(data.fileContent.name, data.fileContent.mimeType, data.fileContent.content);
    } catch {
      alert("Could not download that file.");
    }
  };
}

/** A list of file chips with Download, and Remove when `onRemove` is given and the file allows it. */
export function FileList({ files, onRemove }: { files: Pick<FileInfo, "id" | "name" | "sizeBytes" | "canDelete">[]; onRemove?: (id: string) => void }) {
  const download = useDownload();
  if (files.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-1.5 text-sm">
          <span aria-hidden="true">📎</span>
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          <span className="shrink-0 text-xs text-slate-400">{fmtSize(f.sizeBytes)}</span>
          <button type="button" onClick={() => download(f)} className="shrink-0 text-xs font-medium text-plum-800 underline">Download</button>
          {onRemove && f.canDelete && (
            <button type="button" onClick={() => onRemove(f.id)} className="shrink-0 text-xs font-medium text-red-600 underline">Remove</button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A button that opens the file chooser and hands back the chosen files. */
export function AttachButton({ onPick, disabled, label = "Attach a file" }: { onPick: (files: File[]) => void; disabled?: boolean; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" multiple accept={ACCEPT} className="hidden" tabIndex={-1}
        onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ""; if (list.length) onPick(list); }} />
      <Button type="button" variant="outline" disabled={disabled} onClick={() => ref.current?.click()}>{label}</Button>
    </>
  );
}

/** Files that belong to an assignment or to one task, with attach/remove when allowed. */
function ParentFiles({ kind, parentId, title, canAttach, locked, empty }: {
  kind: "TASK" | "ASSIGNMENT"; parentId: string; title: string; canAttach: boolean; locked?: boolean; empty?: string;
}) {
  const { data } = useQuery<{ files: FileInfo[] }>(FILES, { variables: { kind, parentId }, fetchPolicy: "cache-and-network" });
  const [attach] = useMutation<any>(ATTACH_FILE, { refetchQueries: [FILES] });
  const [remove] = useMutation<any>(DELETE_FILE, { refetchQueries: [FILES] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const files = data?.files ?? [];

  async function pick(list: File[]) {
    setError("");
    const problem = checkPicked(list, files.length);
    if (problem) return setError(problem);
    setBusy(true);
    for (const file of list) {
      try {
        const { data: res } = await attach({ variables: { kind, parentId, name: file.name, content: await toBase64(file) } });
        const err = res?.attachFile.errors[0];
        if (err) { setError(err.message); break; }
      } catch {
        setError(`Could not upload ${file.name}.`);
        break;
      }
    }
    setBusy(false);
  }

  if (!canAttach && files.length === 0 && !empty) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      {files.length === 0 && empty && <p className="text-sm text-slate-500">{empty}</p>}
      <FileList files={files} onRemove={locked ? undefined : (id) => remove({ variables: { id } })} />
      {canAttach && !locked && (
        <div className="flex flex-wrap items-center gap-3">
          <AttachButton onPick={pick} disabled={busy} label={busy ? "Uploading…" : "Attach a file"} />
          <span className="text-xs text-slate-400">{FILE_HINT}</span>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* doing the work                                                     */
/* ------------------------------------------------------------------ */

/** The student's side: written answer, files, Submit / Unsubmit. */
function WorkPanel({ taskId }: { taskId: string }) {
  const { data } = useQuery<{ taskWork: TaskWork }>(TASK_WORK, { variables: { taskId }, fetchPolicy: "cache-and-network" });
  const [save, { loading }] = useMutation<any>(SAVE_WORK, {
    refetchQueries: [TASK_WORK, TASKS, DUE_SOON, ASSIGNMENTS, SUBMISSIONS],
  });
  const [draft, setDraft] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const work = data?.taskWork;
  if (!work) return <p className="text-sm text-slate-500">Loading…</p>;

  const answer = draft ?? work.answer ?? "";
  const submitted = !!work.submittedAt;

  async function run(vars: Record<string, unknown>) {
    setError(""); setSaved(false);
    const { data: res } = await save({ variables: { taskId, ...vars } });
    const err = res?.saveWork.errors[0];
    if (err) return setError(err.message);
    setDraft(undefined);
    if (!vars.submit && !vars.unsubmit) setSaved(true);
  }

  return (
    <section aria-label="Your work" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Your work</h3>
        {submitted && <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">Handed in {when(work.submittedAt!)}</span>}
      </div>

      {submitted ? (
        <>
          {work.answer && <p className="whitespace-pre-wrap wrap-break-word rounded-xl bg-slate-50 p-3 text-sm">{work.answer}</p>}
          <ParentFiles kind="TASK" parentId={taskId} title="Your files" canAttach={false} locked />
          {!work.answer && <p className="text-sm text-slate-500">You handed in files only.</p>}
          <Button type="button" variant="secondary" disabled={loading} onClick={() => run({ unsubmit: true })}>Unsubmit to change it</Button>
        </>
      ) : (
        <>
          <div>
            <label htmlFor={`answer-${taskId}`} className="sr-only">Your answer</label>
            <textarea id={`answer-${taskId}`} rows={5} className={fieldCls} value={answer}
              placeholder="Write your answer here, or attach a file below."
              onChange={(e) => { setDraft(e.target.value); setSaved(false); }} />
          </div>
          <ParentFiles kind="TASK" parentId={taskId} title="Your files" canAttach />
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={loading} onClick={() => run({ answer, submit: true })}>Hand in</Button>
            <Button type="button" variant="secondary" disabled={loading} onClick={() => run({ answer })}>Save draft</Button>
            {saved && <span className="text-xs text-slate-500">Draft saved</span>}
          </div>
        </>
      )}
    </section>
  );
}

/** What a student opens: the teacher's files, then their own work. Used by the Assignments tab and the Tasks page. */
export function WorkSheet({ taskId, assignmentId }: { taskId: string; assignmentId: string | null }) {
  return (
    <div className="space-y-5">
      {assignmentId && <ParentFiles kind="ASSIGNMENT" parentId={assignmentId} title="Files from the teacher" canAttach={false} />}
      <WorkPanel taskId={taskId} />
    </div>
  );
}

/** The teacher's side: who has handed in what. */
function SubmissionsList({ assignmentId }: { assignmentId: string }) {
  const { data } = useQuery<{ submissions: Submission[] }>(SUBMISSIONS, { variables: { assignmentId }, fetchPolicy: "cache-and-network" });
  const rows = data?.submissions ?? [];
  const handed = rows.filter((r) => r.submittedAt).length;
  return (
    <section aria-label="Submissions" className="space-y-3">
      <h3 className="text-sm font-semibold">Submissions <span className="font-normal text-slate-500">{handed} of {rows.length} handed in</span></h3>
      {rows.length === 0 && <p className="text-sm text-slate-500">Nobody has this assignment yet.</p>}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.taskId} className="rounded-xl border border-slate-100 p-3">
            <div className="flex items-center gap-2">
              <Avatar name={r.student.displayName} url={r.student.avatarUrl} size={28} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.student.displayName}</span>
              <span className={`text-xs ${r.submittedAt ? "font-medium text-emerald-700" : "text-slate-400"}`}>
                {r.submittedAt ? `Handed in ${when(r.submittedAt)}` : "Not handed in"}
              </span>
            </div>
            {r.submittedAt && (
              <div className="mt-2 space-y-2">
                {r.answer && <p className="whitespace-pre-wrap wrap-break-word rounded-lg bg-slate-50 p-2.5 text-sm">{r.answer}</p>}
                <FileList files={r.files} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* the Assignments tab                                                */
/* ------------------------------------------------------------------ */

/** The Assignments tab of a shared course. `courseId` is the viewer's own course id. */
export function Assignments({ courseId, canAssign }: { courseId: string; canAssign: boolean }) {
  const { data } = useQuery<AssignmentsData>(ASSIGNMENTS, { variables: { courseId }, fetchPolicy: "cache-and-network" });
  const refetchQueries = [ASSIGNMENTS, TASKS, DUE_SOON];
  const [remove] = useMutation<any>(DELETE_ASSIGNMENT, { refetchQueries });
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const items = data?.assignments ?? [];

  return (
    <div className="space-y-4">
      {canAssign && !adding && <Button onClick={() => { setAdding(true); setEditingId(null); }}>New assignment</Button>}
      {adding && (
        <Card role="region" aria-label="New assignment">
          <TaskForm assignTo={courseId} onDone={() => setAdding(false)} />
        </Card>
      )}

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">No assignments yet.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => {
            if (editingId === a.id) return <li key={a.id}><Card><TaskForm assignment={a} onDone={() => setEditingId(null)} /></Card></li>;
            const open = openId === a.id;
            const handedIn = a.myStatus === "done";
            const late = a.myTaskId && !handedIn && isPastDue(a.dueDate);
            return (
              <li key={a.id} className="rounded-2xl border border-slate-100 bg-white shadow-sm">
                <button type="button" aria-expanded={open} aria-controls={`assignment-${a.id}`}
                  onClick={() => setOpenId(open ? null : a.id)}
                  className="flex w-full items-start gap-3 rounded-2xl p-4 text-left hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{a.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className={late ? "font-semibold text-red-600" : "text-slate-500"}>{dueLabel(a.dueDate)}</span>
                      <span className="text-slate-400">Set by {a.author.displayName}</span>
                      {a.myTaskId && (
                        <span className={`rounded-full px-2 py-0.5 font-medium ${handedIn ? "bg-emerald-100 text-emerald-800" : late ? "bg-red-100 text-red-700" : "bg-plum-800/10 text-plum-800"}`}>
                          {handedIn ? "Handed in" : late ? "Overdue" : "To do"}
                        </span>
                      )}
                      {a.total !== null && a.doneCount !== null && <span className="text-slate-500">{a.doneCount} of {a.total} handed in</span>}
                    </div>
                  </div>
                  <span aria-hidden="true" className={`mt-1 text-slate-400 transition ${open ? "rotate-180" : ""}`}>▾</span>
                </button>

                {open && (
                  <div id={`assignment-${a.id}`} className="space-y-5 border-t border-slate-100 p-4">
                    {a.notes ? <p className="whitespace-pre-wrap wrap-break-word text-sm text-slate-700">{a.notes}</p>
                      : <p className="text-sm text-slate-400">No instructions.</p>}
                    <ParentFiles kind="ASSIGNMENT" parentId={a.id} title="Files" canAttach={a.canEdit} />
                    {a.myTaskId && <WorkPanel taskId={a.myTaskId} />}
                    {a.canEdit && <SubmissionsList assignmentId={a.id} />}
                    {a.canEdit && (
                      <div className="flex gap-2 border-t border-slate-100 pt-3 text-sm">
                        <button onClick={() => { setEditingId(a.id); setAdding(false); }} className="rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100">Edit</button>
                        <button onClick={() => { if (confirm(`Delete "${a.title}"? It is removed from everyone's tasks.`)) remove({ variables: { id: a.id } }); }}
                          className="rounded-lg px-2 py-1 text-red-600 hover:bg-red-50">Delete</button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}