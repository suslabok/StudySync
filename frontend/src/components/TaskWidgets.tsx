import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@apollo/client/react";
import { Banner, Button, Card, LoadError, fieldCls } from "./AppShell";
import { DASHBOARD, type DashboardData } from "../graphql/dashboard";
import { CREATE_ASSIGNMENT_FULL } from "../graphql/files";
import { FileAttach, FilePicker, Submissions, TaskWorkPanel, useUploader } from "./TaskFiles";
import {
  ASSIGNMENTS, CREATE_TASK, DELETE_ASSIGNMENT, DUE_SOON,
  SET_TASK_STATUS, TASKS, UPDATE_ASSIGNMENT, UPDATE_TASK, dueLabel, isPastDue,
  type Assignment, type AssignmentsData, type Task,
} from "../graphql/tasks";

type Props = {
  task?: Task;              // edit a personal task
  assignment?: Assignment;  // edit a course assignment
  assignTo?: string;        // create a course assignment on this (own) course id
  onDone: () => void;
};

/** One form for personal tasks and course assignments. Assignments have no course picker. */
export function TaskForm({ task, assignment, assignTo, onDone }: Props) {
  const assigning = !!assignTo || !!assignment;
  const existing = task ?? assignment;
  const { data } = useQuery<DashboardData>(DASHBOARD, { fetchPolicy: "cache-first", skip: assigning });
  const courses = data?.dashboard.courses ?? [];
  const [title, setTitle] = useState(existing?.title ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  // Priority is no longer chosen in the form; keep the existing value so the API still gets one
  const priority = existing?.priority ?? 2;
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? "");
  const [courseId, setCourseId] = useState(task?.course?.id ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const refetchQueries = [TASKS, DUE_SOON, ASSIGNMENTS];
  const [createTask, c1] = useMutation<any>(CREATE_TASK, { refetchQueries });
  const [updateTask, c2] = useMutation<any>(UPDATE_TASK, { refetchQueries });
  const [createAssignment, c3] = useMutation<any>(CREATE_ASSIGNMENT_FULL, { refetchQueries });
  const [pending, setPending] = useState<File[]>([]);   // files chosen before the assignment exists
  const upload = useUploader();
  const [updateAssignment, c4] = useMutation<any>(UPDATE_ASSIGNMENT, { refetchQueries });
  const busy = c1.loading || c2.loading || c3.loading || c4.loading;

  const FIELDS = ["title", "notes", "priority", "dueDate", "courseId"];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    const input = { title, notes: notes || null, priority, dueDate: dueDate || null };
    try {
      let payload;
      if (assignment) payload = (await updateAssignment({ variables: { id: assignment.id, input } })).data?.updateAssignment;
      else if (assignTo) {
        payload = (await createAssignment({ variables: { courseId: assignTo, input } })).data?.createAssignment;
        const newId = payload?.assignment?.id;
        if (!payload?.errors?.length && newId) {
          const failed: string[] = [];
          for (const f of pending) {
            const msg = await upload("ASSIGNMENT", newId, f);
            if (msg) failed.push(msg);
          }
          // the assignment exists now, so don't keep the form open: tell the user and close
          if (failed.length) window.alert(`The assignment was created, but some files were not attached.\n${failed.join("\n")}\nOpen it and use Files to add them again.`);
        }
      }
      else if (task) payload = (await updateTask({ variables: { id: task.id, input: { ...input, courseId: courseId || null } } })).data?.updateTask;
      else payload = (await createTask({ variables: { input: { ...input, courseId: courseId || null } } })).data?.createTask;
      if (payload?.errors?.length) {
        const next: Record<string, string> = {};
        // an error for a field this form doesn't show goes to the form-level message
        for (const er of payload.errors) next[er.field && FIELDS.includes(er.field) ? er.field : "form"] ??= er.message;
        return setErrors(next);
      }
      onDone();
    } catch (ex) {
      console.error(ex);
      setErrors({ form: "Something went wrong. Please try again." });
    }
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
      {assignment && (
        <div>
          <p className="mb-1 text-sm font-medium">Files</p>
          <FileAttach kind="ASSIGNMENT" parentId={assignment.id} canEdit />
        </div>
      )}
      {assignTo && <FilePicker files={pending} onChange={setPending} />}
      {err("form")}
      <div className="flex gap-2">
        <Button disabled={busy}>{assignment || task ? "Save changes" : assigning ? "Assign" : "Add task"}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

/** The Assignments tab of a shared course. `courseId` is the viewer's own course id. */
export function Assignments({ courseId, canAssign }: { courseId: string; canAssign: boolean }) {
  const { data, error, refetch } = useQuery<AssignmentsData>(ASSIGNMENTS, { variables: { courseId }, fetchPolicy: "cache-and-network" });
  const refetchQueries = [ASSIGNMENTS, TASKS, DUE_SOON];
  const [setStatus] = useMutation<any>(SET_TASK_STATUS, { refetchQueries });
  const [remove] = useMutation<any>(DELETE_ASSIGNMENT, { refetchQueries });
  const [actionError, setActionError] = useState("");

  async function run(p: Promise<any>) {
    setActionError("");
    try {
      const { data: d } = await p;
      const errs = (d && (Object.values(d)[0] as any))?.errors;
      if (errs?.length) setActionError(errs[0].message);
    } catch (e) {
      console.error(e);
      setActionError("Something went wrong. Please try again.");
    }
  }
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const items = data?.assignments ?? [];

  return (
    <div className="space-y-4">
      {canAssign && !adding && <Button onClick={() => { setAdding(true); setEditingId(null); }}>New assignment</Button>}
      {actionError && <Banner>{actionError}</Banner>}
      {adding && (
        <Card role="region" aria-label="New assignment">
          <TaskForm assignTo={courseId} onDone={() => setAdding(false)} />
        </Card>
      )}

      {error && !data ? (
        <LoadError what="assignments" onRetry={() => refetch()} />
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">No assignments yet.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((a) =>
            editingId === a.id ? (
              <li key={a.id}><Card><TaskForm assignment={a} onDone={() => setEditingId(null)} /></Card></li>
            ) : (
              <li key={a.id} className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                {a.myTaskId && (
                  <input type="checkbox" checked={a.myStatus === "done"}
                    aria-label={`Mark "${a.title}" ${a.myStatus === "done" ? "not done" : "done"}`}
                    onChange={() => run(setStatus({ variables: { id: a.myTaskId, status: a.myStatus === "done" ? "todo" : "done" } }))}
                    className="mt-1 h-5 w-5 shrink-0 accent-plum-800" />
                )}
                <div className="min-w-0 flex-1">
                  <p className={`font-semibold ${a.myStatus === "done" ? "text-slate-400 line-through" : ""}`}>{a.title}</p>
                  {a.notes && <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-500">{a.notes}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className={a.myStatus !== "done" && isPastDue(a.dueDate) ? "font-semibold text-red-600" : "text-slate-500"}>
                      {dueLabel(a.dueDate)}
                    </span>
                    <span className="text-slate-400">Set by {a.author.displayName}</span>
                    {a.myStatus === "doing" && <span className="font-medium text-plum-800">In progress</span>}
                  </div>
                  {a.total !== null && a.doneCount !== null && (
                    <div className="mt-3">
                      <div className="h-1.5 overflow-hidden rounded-full bg-sun-300/50" role="progressbar" aria-label="Class progress"
                        aria-valuenow={a.total ? Math.round((a.doneCount / a.total) * 100) : 0} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full rounded-full bg-sun-400" style={{ width: `${a.total ? (a.doneCount / a.total) * 100 : 0}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{a.doneCount} of {a.total} done</p>
                    </div>
                  )}
                  <AssignmentExtras a={a} />
                </div>
                {a.canEdit && (
                  <div className="flex shrink-0 gap-1 text-sm">
                    <button onClick={() => { setEditingId(a.id); setAdding(false); }} className="rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100">Edit</button>
                    <button onClick={() => { if (window.confirm(`Delete "${a.title}"? It is removed from everyone's tasks.`)) run(remove({ variables: { id: a.id } })); }}
                      className="rounded-lg px-2 py-1 text-red-600 hover:bg-red-50">Delete</button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

/** Files, the student's own work, and (for the assigner) what everyone handed in. Loaded only when opened. */
function AssignmentExtras({ a }: { a: Assignment }) {
  const [panel, setPanel] = useState<"files" | "work" | "subs" | null>(null);
  const tabs: { key: "files" | "work" | "subs"; label: string }[] = [{ key: "files", label: "Files" }];
  if (a.myTaskId) tabs.push({ key: "work", label: "My work" });
  if (a.canEdit) tabs.push({ key: "subs", label: "Submissions" });
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.key} type="button" aria-expanded={panel === t.key}
            onClick={() => setPanel(panel === t.key ? null : t.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              panel === t.key ? "bg-plum-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {panel && (
        <div className="mt-3">
          {panel === "files" && <FileAttach kind="ASSIGNMENT" parentId={a.id} canEdit={a.canEdit} />}
          {panel === "work" && a.myTaskId && <TaskWorkPanel taskId={a.myTaskId} />}
          {panel === "subs" && <Submissions assignmentId={a.id} />}
        </div>
      )}
    </div>
  );
}