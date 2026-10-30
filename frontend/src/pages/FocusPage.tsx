import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@apollo/client/react";
import { AppShell, Banner, Button, Card, SemesterNav, SemesterSummary, fieldCls } from "../components/AppShell";
import { DASHBOARD, SEMESTERS, type DashboardData, type SemestersData } from "../graphql/dashboard";
import { DELETE_FOCUS, FOCUS_SESSIONS, LOG_FOCUS, fmtDuration, type FocusSession } from "../graphql/focus";
import { TASKS, type TasksData } from "../graphql/tasks";

type Mode = "focus" | "short" | "long";
type Status = "idle" | "running" | "paused";

const MODES: Record<Mode, { label: string; defaultMin: number; max: number }> = {
  focus: { label: "Focus", defaultMin: 25, max: 180 },
  short: { label: "Short break", defaultMin: 5, max: 60 },
  long: { label: "Long break", defaultMin: 15, max: 60 },
};
const MIN_LOGGED = 60;          // a focus session shorter than a minute isn't saved
const STORE = "studysync.focus";

// buttons on the plum timer panel
const PRIMARY = "rounded-xl bg-plum-800 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-plum-900";
const GHOST = "rounded-xl border border-plum-900/40 px-5 py-2.5 text-sm font-semibold text-plum-900 transition hover:bg-white/25 disabled:opacity-50";

type Timer = {
  mode: Mode; status: Status;
  plannedMs: number; remainingMs: number; targetEnd: number | null;
  startedAt: string | null;
  target: string;               // "" | "course:<id>" | "task:<id>", fixed when the timer starts
};
type Unsaved = { startedAt: string; seconds: number; plannedSeconds: number; target: string };

const idle = (mode: Mode, minutes: Record<Mode, number>, target: string): Timer => ({
  mode, status: "idle", plannedMs: minutes[mode] * 60_000, remainingMs: minutes[mode] * 60_000,
  targetEnd: null, startedAt: null, target,
});

function load(): { timer: Timer; minutes: Record<Mode, number> } {
  const minutes = { focus: 25, short: 5, long: 15 };
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "null");
    if (raw?.minutes) for (const m of Object.keys(minutes) as Mode[]) if (Number.isFinite(raw.minutes[m])) minutes[m] = raw.minutes[m];
    const t = raw?.timer;
    if (t && t.mode in MODES && ["idle", "running", "paused"].includes(t.status)) return { timer: t, minutes };
  } catch { /* nothing saved, or a private window */ }
  return { minutes, timer: idle("focus", minutes, "") };
}

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25, 0.5].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.2);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch { /* no audio available */ }
}

export default function FocusPage() {
  const navigate = useNavigate();
  const initial = useRef(load()).current;
  const [minutes, setMinutes] = useState(initial.minutes);
  const [timer, setTimer] = useState<Timer>(initial.timer);
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState("");
  const [unsaved, setUnsaved] = useState<Unsaved | null>(null);
  const finishing = useRef(false);

  // data
  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const { data: sessionData } = useQuery<{ focusSessions: FocusSession[] }>(FOCUS_SESSIONS, { variables: { since }, fetchPolicy: "cache-and-network" });
  const { data: dash } = useQuery<DashboardData>(DASHBOARD, { fetchPolicy: "cache-and-network" });
  const { data: taskData } = useQuery<TasksData>(TASKS, { fetchPolicy: "cache-and-network" });
  const { data: semData } = useQuery<SemestersData>(SEMESTERS, { fetchPolicy: "cache-and-network" });
  const [log, { loading: saving }] = useMutation<any>(LOG_FOCUS, { refetchQueries: [FOCUS_SESSIONS] });
  const [removeSession] = useMutation<any>(DELETE_FOCUS, { refetchQueries: [FOCUS_SESSIONS] });

  const sem = dash?.dashboard.currentSemester ?? null;
  const courses = dash?.dashboard.courses ?? [];
  const openTasks = (taskData?.tasks ?? []).filter((t) => t.status !== "done");
  const semesterNav = sem && (
    <SemesterNav semesters={semData?.semesters ?? []} current={sem}
      onSelect={(sid) => navigate("/", { state: sid === sem.id ? null : { viewSemesterId: sid } })}
      onNew={() => navigate("/", { state: { newSemester: true } })} />
  );

  // remember the timer and the chosen lengths, so a reload or a closed tab doesn't lose a running session
  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ timer, minutes })); } catch { /* not remembered */ }
  }, [timer, minutes]);

  const running = timer.status === "running";
  const remaining = running && timer.targetEnd ? Math.max(0, timer.targetEnd - now) : timer.remainingMs;
  const elapsedSeconds = Math.round((timer.plannedMs - remaining) / 1000);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (timer.status === "idle") return;
    const prev = document.title;
    document.title = `${clock(remaining)} · ${MODES[timer.mode].label}`;
    return () => { document.title = prev; };
  }, [remaining, timer.status, timer.mode]);

  async function save(s: Unsaved) {
    const [kind, id] = s.target.split(":");
    try {
      const { data } = await log({
        variables: { input: {
          startedAt: s.startedAt, seconds: s.seconds, plannedSeconds: s.plannedSeconds,
          courseId: kind === "course" ? id : null, taskId: kind === "task" ? id : null,
        } },
      });
      const err = data?.logFocusSession.errors?.[0];
      if (err) { setUnsaved(null); setNotice(`Could not save that session: ${err.message}`); return; }
      setUnsaved(null);
    } catch {
      setUnsaved(s);                                   // network trouble: keep it so it can be retried
    }
  }

  function finish(completed: boolean) {
    if (finishing.current) return;
    finishing.current = true;
    const seconds = completed ? Math.round(timer.plannedMs / 1000) : elapsedSeconds;
    const wasFocus = timer.mode === "focus";

    if (wasFocus && seconds >= MIN_LOGGED && timer.startedAt) {
      void save({ startedAt: timer.startedAt, seconds, plannedSeconds: Math.round(timer.plannedMs / 1000), target: timer.target });
    }
    if (completed) {
      beep();
      try {
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification(wasFocus ? "Focus session done" : "Break over", { body: wasFocus ? "Nice work. Take a break." : "Ready for the next one?" });
        }
      } catch { /* notifications unavailable */ }
    }

    // after a focus: suggest a break (a long one after every 4th session today); after a break: focus again
    const doneToday = todaySessions.length + (wasFocus && seconds >= MIN_LOGGED ? 1 : 0);
    const next: Mode = wasFocus ? (doneToday > 0 && doneToday % 4 === 0 ? "long" : "short") : "focus";
    setNotice(completed
      ? wasFocus ? `Session done: ${fmtDuration(seconds)} focused. Time for a ${MODES[next].label.toLowerCase()}.` : "Break over. Ready when you are."
      : wasFocus ? (seconds >= MIN_LOGGED ? `Saved ${fmtDuration(seconds)} of focus.` : "Under a minute, so it wasn't saved.") : "");
    setTimer(idle(next, minutes, timer.target));
    finishing.current = false;
  }

  // the timer reached zero (also when the page was closed and reopened afterwards)
  useEffect(() => {
    if (running && remaining <= 0) finish(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, remaining]);

  function start() {
    setNotice("");
    try { if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission(); } catch { /* ignore */ }
    const t = Date.now();
    setNow(t);
    if (timer.status === "paused") {
      setTimer({ ...timer, status: "running", targetEnd: t + timer.remainingMs });
    } else {
      const ms = minutes[timer.mode] * 60_000;
      setTimer({ ...timer, status: "running", plannedMs: ms, remainingMs: ms, targetEnd: t + ms, startedAt: new Date(t).toISOString() });
    }
  }
  function pause() {
    setTimer({ ...timer, status: "paused", remainingMs: Math.max(0, (timer.targetEnd ?? Date.now()) - Date.now()), targetEnd: null });
  }
  function reset() {
    if (timer.mode === "focus" && elapsedSeconds >= MIN_LOGGED && !confirm("Discard this session without saving it?")) return;
    setNotice("");
    setTimer(idle(timer.mode, minutes, timer.target));
  }
  function setMode(mode: Mode) {
    setNotice("");
    setTimer(idle(mode, minutes, timer.target));
  }
  function setLength(value: string) {
    const max = MODES[timer.mode].max;
    const n = Math.min(max, Math.max(1, Math.round(Number(value) || 1)));
    const next = { ...minutes, [timer.mode]: n };
    setMinutes(next);
    setTimer(idle(timer.mode, next, timer.target));
  }

  /* ---- numbers for the stats ---- */
  const sessions = sessionData?.focusSessions ?? [];
  const todayKey = dayKey(new Date());
  const todaySessions = sessions.filter((s) => dayKey(new Date(s.startedAt)) === todayKey);
  const week = useMemo(() => {
    const out: { key: string; label: string; seconds: number; isToday: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push({ key: dayKey(d), label: d.toLocaleDateString(undefined, { weekday: "short" }), seconds: 0, isToday: i === 0 });
    }
    for (const s of sessions) {
      const day = out.find((x) => x.key === dayKey(new Date(s.startedAt)));
      if (day) day.seconds += s.seconds;
    }
    return out;
  }, [sessions]);
  const weekTotal = week.reduce((n, d) => n + d.seconds, 0);
  const todayTotal = week[6].seconds;
  const maxDay = Math.max(1, ...week.map((d) => d.seconds));

  const byCourse = useMemo(() => {
    const weekKeys = new Set(week.map((d) => d.key));
    const map = new Map<string, { code: string; color: string; seconds: number }>();
    for (const s of sessions) {
      if (!weekKeys.has(dayKey(new Date(s.startedAt)))) continue;
      const key = s.course?.id ?? "none";
      const row = map.get(key) ?? { code: s.course?.code ?? "No course", color: s.course?.color ?? "#94a3b8", seconds: 0 };
      row.seconds += s.seconds;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.seconds - a.seconds);
  }, [sessions, week]);

  const progress = timer.plannedMs ? Math.min(100, Math.round(((timer.plannedMs - remaining) / timer.plannedMs) * 100)) : 0;
  const active = timer.status !== "idle";
  const canStop = timer.mode === "focus" && elapsedSeconds >= MIN_LOGGED;

  return (
    <AppShell
      semesterNav={semesterNav}
      side={dash ? <SemesterSummary shown={sem} courses={courses} /> : null}
      main={
        <div className="space-y-8">
          <header>
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Focus timer</h1>
          </header>

          <section aria-label="Timer" className="space-y-6 rounded-3xl bg-coral-400 p-6 text-plum-900 shadow-sm sm:p-8">
            <div role="tablist" aria-label="Timer mode" className="flex flex-wrap gap-2">
              {(Object.keys(MODES) as Mode[]).map((m) => (
                <button key={m} role="tab" aria-selected={timer.mode === m} disabled={active} onClick={() => setMode(m)}
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed ${
                    timer.mode === m ? "bg-plum-800 text-white" : "bg-white/30 text-plum-900 enabled:hover:bg-white/50"}`}>
                  {MODES[m].label}
                </button>
              ))}
            </div>

            <div className="text-center">
              <p className="font-mono text-7xl font-extrabold tabular-nums tracking-tight sm:text-8xl" role="timer" aria-live="off"
                aria-label={`${clock(remaining)} left`}>
                {clock(remaining)}
              </p>
              <div className="mx-auto mt-4 h-2 max-w-md overflow-hidden rounded-full bg-white/40"
                role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                <div className="h-full rounded-full bg-plum-800 transition-[width] duration-300" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-2 text-sm text-plum-900/80" aria-live="polite">
                {timer.status === "running" ? (timer.mode === "focus" ? "Stay with it." : "Rest a little.")
                  : timer.status === "paused" ? "Paused." : ""}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              {timer.status === "running"
                ? <button onClick={pause} className={PRIMARY}>Pause</button>
                : <button onClick={start} className={PRIMARY}>{timer.status === "paused" ? "Resume" : "Start"}</button>}
              {timer.mode === "focus" && active && (
                <button disabled={!canStop} onClick={() => finish(false)} className={GHOST}
                  title={canStop ? undefined : "Focus for at least a minute to save it"}>Stop &amp; save</button>
              )}
              {active && <button onClick={reset} className={GHOST}>Reset</button>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="focus-target" className="text-sm font-medium text-plum-900">Working on</label>
                <select id="focus-target" className={`${fieldCls} text-plum-900 disabled:bg-white/60`} value={timer.target} disabled={active || timer.mode !== "focus"}
                  onChange={(e) => setTimer({ ...timer, target: e.target.value })}>
                  <option value="">Nothing in particular</option>
                  {courses.length > 0 && (
                    <optgroup label="Courses">
                      {courses.map((c) => <option key={c.id} value={`course:${c.id}`}>{c.code}</option>)}
                    </optgroup>
                  )}
                  {openTasks.length > 0 && (
                    <optgroup label="Open tasks">
                      {openTasks.map((t) => <option key={t.id} value={`task:${t.id}`}>{t.course ? `${t.course.code} · ` : ""}{t.title}</option>)}
                    </optgroup>
                  )}
                </select>
              </div>
              <div>
                <label htmlFor="focus-minutes" className="text-sm font-medium text-plum-900">{MODES[timer.mode].label} length (minutes)</label>
                <input id="focus-minutes" type="number" min={1} max={MODES[timer.mode].max} className={`${fieldCls} text-plum-900 disabled:bg-white/60`}
                  value={minutes[timer.mode]} disabled={active} onChange={(e) => setLength(e.target.value)} />
              </div>
            </div>

            {notice && <Banner kind="ok">{notice}</Banner>}
            {unsaved && (
              <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                Could not reach the server, so {fmtDuration(unsaved.seconds)} of focus isn't saved yet.
                <Button variant="secondary" className="bg-white py-1" disabled={saving} onClick={() => void save(unsaved)}>Try again</Button>
              </div>
            )}
          </section>

          <section aria-label="Your focus time" className="space-y-4">
            <h2 className="text-xl font-extrabold">Your focus time</h2>
            <p className="text-sm text-slate-600">
              <strong>{fmtDuration(todayTotal)}</strong> today · <strong>{fmtDuration(weekTotal)}</strong> in the last 7 days ·{" "}
              <strong>{todaySessions.length}</strong> {todaySessions.length === 1 ? "session" : "sessions"} today
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="text-sm font-bold">Last 7 days</h3>
              <ul className="mt-4 grid grid-cols-7 items-end gap-2">
                {week.map((d) => (
                  <li key={d.key} className="flex flex-col items-center gap-1" aria-label={`${d.label}: ${fmtDuration(d.seconds)}`}>
                    <span className="text-[11px] font-medium text-slate-500">{d.seconds ? fmtDuration(d.seconds) : ""}</span>
                    <span className="flex h-28 w-full items-end">
                      <span className={`w-full rounded-t-lg ${d.isToday ? "bg-sun-400" : "bg-plum-800/30"}`}
                        style={{ height: `${d.seconds ? Math.max(4, Math.round((d.seconds / maxDay) * 100)) : 2}%` }} />
                    </span>
                    <span className={`text-xs ${d.isToday ? "font-bold" : "text-slate-500"}`}>{d.label}</span>
                  </li>
                ))}
              </ul>
            </Card>

            {byCourse.length > 0 && (
              <Card>
                <h3 className="text-sm font-bold">By course, last 7 days</h3>
                <ul className="mt-3 space-y-3">
                  {byCourse.map((c) => (
                    <li key={c.code}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 font-medium">
                          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />{c.code}
                        </span>
                        <span className="text-slate-600">{fmtDuration(c.seconds)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full" style={{ width: `${Math.round((c.seconds / weekTotal) * 100)}%`, backgroundColor: c.color }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            </div>

            <Card>
              <h3 className="text-sm font-bold">Recent sessions</h3>
              {sessions.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No sessions yet. Start the timer to log your first one.</p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100">
                  {sessions.slice(0, 8).map((s) => (
                    <li key={s.id} className="flex items-center gap-3 py-2.5">
                      <span aria-hidden="true" className="h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.course?.color ?? "#94a3b8" }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {s.taskTitle ?? (s.course ? s.course.code : "Focus session")}
                        </p>
                        <p className="text-xs text-slate-500">
                          {new Date(s.startedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                          {s.taskTitle && s.course && ` · ${s.course.code}`}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-medium">{fmtDuration(s.seconds)}</span>
                      <button onClick={() => { if (confirm("Delete this session?")) removeSession({ variables: { id: s.id } }); }}
                        aria-label="Delete session" className="shrink-0 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600">✕</button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      }
    />
  );
}