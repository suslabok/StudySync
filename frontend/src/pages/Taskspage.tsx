import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@apollo/client/react";
import { AppShell, Banner, Button, Card, SemesterNav, SemesterSummary } from "../components/AppShell";
import { TaskForm } from "../components/TaskWidgets";
import { TaskWorkPanel } from "../components/TaskFiles";
import { DASHBOARD, SEMESTERS, type DashboardData, type SemestersData } from "../graphql/dashboard";
import {
  DELETE_TASK, DUE_SOON, SET_TASK_STATUS, TASKS,
  dueLabel, isOverdue, type TasksData,
} from "../graphql/tasks";

type Filter = "open" | "done" | "all";

function Tile({ value, label, alert = false }: { value: string; label: string; alert?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 text-center shadow-sm">
      <p className={`text-2xl font-extrabold tracking-tight ${alert ? "text-red-600" : ""}`}>{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
    </div>
  );
}

export default function TasksPage() {
  const { data, error, refetch } = useQuery<TasksData>(TASKS, { fetchPolicy: "cache-and-network" });
  const { data: dash } = useQuery<DashboardData>(DASHBOARD, { fetchPolicy: "cache-and-network" });

  // Same side panels as the dashboard
  const navigate = useNavigate();
  const { data: semData } = useQuery<SemestersData>(SEMESTERS, { fetchPolicy: "cache-and-network" });
  const sem = dash?.dashboard.currentSemester ?? null;
  const semesterNav = sem && (
    <SemesterNav semesters={semData?.semesters ?? []} current={sem}
      onSelect={(sid) => navigate("/", { state: sid === sem.id ? null : { viewSemesterId: sid } })}
      onNew={() => navigate("/", { state: { newSemester: true } })} />
  );
  const sidePanel = dash ? <SemesterSummary shown={sem} courses={dash.dashboard.courses} /> : null;
  const [filter, setFilter] = useState<Filter>("open");
  const [courseFilter, setCourseFilter] = useState("all"); // "all" | "personal" | a course id
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [workId, setWorkId] = useState<string | null>(null); // the task whose Work panel is open
  const refetchQueries = [TASKS, DUE_SOON];
  const [setStatus] = useMutation<any>(SET_TASK_STATUS, { refetchQueries });
  const [remove] = useMutation<any>(DELETE_TASK, { refetchQueries });
  const [actionError, setActionError] = useState("");

  /** Run a mutation and show a payload error or a network failure instead of ignoring it. */
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

  const all = data?.tasks ?? [];
  const inCourse = all.filter((t) =>
    courseFilter === "all" ? true : courseFilter === "personal" ? !t.course : t.course?.id === courseFilter);
  const open = inCourse.filter((t) => t.status !== "done");
  const done = inCourse.filter((t) => t.status === "done");
  const overdue = inCourse.filter((t) => t.status !== "done" && isOverdue(t));
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

          <section aria-label="Overview" className="grid grid-cols-3 gap-3 sm:gap-4">
            <Tile value={String(open.length)} label="Open" />
            <Tile value={String(overdue.length)} label="Overdue" alert={overdue.length > 0} />
            <Tile value={String(done.length)} label="Completed" />
          </section>

          {actionError && <Banner>{actionError}</Banner>}

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
                ) : (
                  <li key={t.id} className="flex flex-wrap items-start gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                    <input type="checkbox" checked={t.status === "done"}
                      aria-label={`Mark "${t.title}" ${t.status === "done" ? "not done" : "done"}`}
                      onChange={() => run(setStatus({ variables: { id: t.id, status: t.status === "done" ? "todo" : "done" } }))}
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
                        {t.assigned && <span className="rounded-full bg-plum-800/10 px-2 py-0.5 font-medium text-plum-800">Assigned</span>}
                        <span className={t.status !== "done" && isOverdue(t) ? "font-semibold text-red-600" : "text-slate-500"}>{dueLabel(t.dueDate)}</span>
                        {t.status === "doing" && <span className="font-medium text-plum-800">In progress</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1 text-sm">
                      <button onClick={() => setWorkId(workId === t.id ? null : t.id)} aria-expanded={workId === t.id}
                        className="rounded-lg px-2 py-1 text-plum-800 hover:bg-slate-100">
                        {workId === t.id ? "Hide work" : "Work"}
                      </button>
                      {t.status !== "done" && (
                        <button onClick={() => run(setStatus({ variables: { id: t.id, status: t.status === "doing" ? "todo" : "doing" } }))}
                          className="rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100">
                          {t.status === "doing" ? "Pause" : "Start"}
                        </button>
                      )}
                      {!t.assigned && (
                        <button onClick={() => { setEditingId(t.id); setAdding(false); }}
                          className="rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100">Edit</button>
                      )}
                      {(!t.assigned || !t.course) && (
                        <button onClick={() => { if (window.confirm(`Delete "${t.title}"?`)) run(remove({ variables: { id: t.id } })); }}
                          className="rounded-lg px-2 py-1 text-red-600 hover:bg-red-50">Delete</button>
                      )}
                    </div>
                    {workId === t.id && <div className="basis-full sm:pl-8"><TaskWorkPanel taskId={t.id} /></div>}
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      }
      semesterNav={semesterNav}
      side={sidePanel}
    />
  );
}