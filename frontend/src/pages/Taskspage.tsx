import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@apollo/client/react";
import { AppShell, Button, Card, SemesterNav, SemesterSummary } from "../components/AppShell";
import { TaskForm, WorkSheet } from "../components/TaskWidgets";
import { DASHBOARD, SEMESTERS, type DashboardData, type SemestersData } from "../graphql/dashboard";
import {
  DELETE_TASK, DUE_SOON, SET_TASK_STATUS, TASKS,
  dueLabel, isOverdue, type Task, type TasksData,
} from "../graphql/tasks";

/** An assigned task: no tick box and no Start/Pause. Click it to read the instructions and do the work. */
function AssignedRow({ task: t, open, onToggle, onDelete }: {
  task: Task; open: boolean; onToggle: () => void; onDelete?: () => void;
}) {
  const handedIn = t.status === "done";
  const late = !handedIn && isOverdue(t);
  return (
    <li className="rounded-2xl border border-slate-100 bg-white shadow-sm">
      <button type="button" aria-expanded={open} onClick={onToggle}
        className="flex w-full items-start gap-3 rounded-2xl p-4 text-left hover:bg-slate-50">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {t.course && (
              <span className="rounded-full px-2 py-0.5 font-semibold text-white" style={{ backgroundColor: t.course.color }}>{t.course.code}</span>
            )}
            <span className={late ? "font-semibold text-red-600" : "text-slate-500"}>{dueLabel(t.dueDate)}</span>
            <span className={`rounded-full px-2 py-0.5 font-medium ${
              handedIn ? "bg-emerald-100 text-emerald-800" : late ? "bg-red-100 text-red-700" : "bg-plum-800/10 text-plum-800"}`}>
              {handedIn ? "Handed in" : late ? "Overdue" : "To hand in"}
            </span>
          </div>
        </div>
        <span aria-hidden="true" className={`mt-1 text-slate-400 transition ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="space-y-5 border-t border-slate-100 p-4">
          {t.notes ? <p className="whitespace-pre-wrap wrap-break-word text-sm text-slate-700">{t.notes}</p>
            : <p className="text-sm text-slate-400">No instructions.</p>}
          <WorkSheet taskId={t.id} assignmentId={t.assignmentId} />
          {onDelete && (
            <div className="border-t border-slate-100 pt-3 text-sm">
              <button onClick={onDelete} className="rounded-lg px-2 py-1 text-red-600 hover:bg-red-50">Delete</button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

type Filter = "open" | "done" | "all";

export default function TasksPage() {
  const { data, error, refetch } = useQuery<TasksData>(TASKS, { fetchPolicy: "cache-and-network" });
  const navigate = useNavigate();
  // Same side panels as the dashboard
  const { data: dash } = useQuery<DashboardData>(DASHBOARD, { fetchPolicy: "cache-and-network" });
  const { data: semData } = useQuery<SemestersData>(SEMESTERS, { fetchPolicy: "cache-and-network" });
  const sem = dash?.dashboard.currentSemester ?? null;
  const semesterNav = sem && (
    <SemesterNav semesters={semData?.semesters ?? []} current={sem}
      onSelect={(sid) => navigate("/", { state: sid === sem.id ? null : { viewSemesterId: sid } })}
      onNew={() => navigate("/", { state: { newSemester: true } })} />
  );
  const [filter, setFilter] = useState<Filter>("open");
  const [courseFilter, setCourseFilter] = useState("all"); // "all" | "personal" | a course id
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null); // the assigned task whose work is showing
  const refetchQueries = [TASKS, DUE_SOON];
  const [setStatus] = useMutation<any>(SET_TASK_STATUS, { refetchQueries });
  const [remove] = useMutation<any>(DELETE_TASK, { refetchQueries });

  const all = data?.tasks ?? [];
  const inCourse = all.filter((t) =>
    courseFilter === "all" ? true : courseFilter === "personal" ? !t.course : t.course?.id === courseFilter);
  const open = inCourse.filter((t) => t.status !== "done");
  const done = inCourse.filter((t) => t.status === "done");
  const shown = filter === "open" ? open : filter === "done" ? done : inCourse;
  const courses = dash?.dashboard.courses ?? [];

  const tabs: [Filter, string, number][] = [["open", "Open", open.length], ["done", "Done", done.length], ["all", "All", inCourse.length]];

  return (
    <AppShell
      main={
        <div className="space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Tasks</h1>
              <p className="mt-1 text-sm text-slate-500">Work your teachers assign, plus your own to-dos.</p>
            </div>
            {!adding && <Button onClick={() => { setAdding(true); setEditingId(null); }}>Add task</Button>}
          </header>

          {adding && (
            <Card role="region" aria-label="New task" className="max-w-2xl"><TaskForm onDone={() => setAdding(false)} /></Card>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Filter tasks" className="flex gap-2">
              {tabs.map(([key, label, n]) => (
                <button key={key} role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                    filter === key ? "bg-plum-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                  {label} <span className="opacity-70">{n}</span>
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Course
              <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium">
                <option value="all">All</option>
                <option value="personal">Personal</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </label>
          </div>

          {error && !data ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800">
              <p>Could not load your tasks.</p>
              <button onClick={() => refetch()} className="mt-2 font-medium underline">Try again</button>
            </div>
          ) : !data ? (
            <p className="text-slate-500">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
              {filter === "done" ? "Nothing completed yet." : "No tasks here. Add one to get started."}
            </p>
          ) : (
            <ul className="space-y-3">
              {shown.map((t) =>
                editingId === t.id ? (
                  <li key={t.id}><Card className="max-w-2xl"><TaskForm task={t} onDone={() => setEditingId(null)} /></Card></li>
                ) : t.assigned && t.assignmentId ? (
                  <AssignedRow key={t.id} task={t} open={openId === t.id}
                    onToggle={() => setOpenId(openId === t.id ? null : t.id)}
                    onDelete={t.course ? undefined : () => { if (confirm(`Delete "${t.title}"?`)) remove({ variables: { id: t.id } }); }} />
                ) : (
                  <li key={t.id} className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                    <input type="checkbox" checked={t.status === "done"}
                      aria-label={`Mark "${t.title}" ${t.status === "done" ? "not done" : "done"}`}
                      onChange={() => setStatus({ variables: { id: t.id, status: t.status === "done" ? "todo" : "done" } })}
                      className="mt-1 h-5 w-5 shrink-0 accent-plum-800" />
                    <div className="min-w-0 flex-1">
                      <p className={`font-semibold ${t.status === "done" ? "text-slate-400 line-through" : ""}`}>{t.title}</p>
                      {t.notes && <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-500">{t.notes}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        {t.course && (
                          <span className="rounded-full px-2 py-0.5 font-semibold text-white" style={{ backgroundColor: t.course.color }}>
                            {t.course.code}
                          </span>
                        )}
                        <span className={isOverdue(t) ? "font-semibold text-red-600" : "text-slate-500"}>{dueLabel(t.dueDate)}</span>
                        {t.status === "doing" && <span className="font-medium text-plum-800">In progress</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1 text-sm">
                      {t.status !== "done" && (
                        <button onClick={() => setStatus({ variables: { id: t.id, status: t.status === "doing" ? "todo" : "doing" } })}
                          className="rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100">
                          {t.status === "doing" ? "Pause" : "Start"}
                        </button>
                      )}
                      <button onClick={() => { setEditingId(t.id); setAdding(false); }}
                        className="rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100">Edit</button>
                      <button onClick={() => { if (confirm(`Delete "${t.title}"?`)) remove({ variables: { id: t.id } }); }}
                        className="rounded-lg px-2 py-1 text-red-600 hover:bg-red-50">Delete</button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      }
      side={dash ? <SemesterSummary shown={sem} courses={dash.dashboard.courses} /> : null}
      semesterNav={semesterNav}
    />
  );
}