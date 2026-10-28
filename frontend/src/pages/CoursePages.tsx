import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@apollo/client/react";
import { AppShell, Button, Card, LoadError, SemesterNav, SemesterSummary } from "../components/AppShell";
import Avatar from "../components/Avatar";
import { Assignments } from "../components/TaskWidgets";
import Stream from "../components/CourseSharing";
import { DASHBOARD, SEMESTERS, type DashboardData, type SemestersData } from "../graphql/dashboard";
import { ASSIGNMENTS, DUE_SOON, TASKS } from "../graphql/tasks";
import {
  COURSE_SPACE, LEAVE_COURSE, REGENERATE_CODE, ROLE_LABEL, SHARE_COURSE, STOP_SHARING,
  type CourseSpace,
} from "../graphql/sharing";

export default function CoursePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, loading, error: loadError, refetch } = useQuery<{ courseSpace: CourseSpace | null }>(COURSE_SPACE, {
    variables: { courseId: id }, fetchPolicy: "cache-and-network",
  });
  // sharing changes also add or drop the assignment tasks, so refresh those lists too
  const opts = { refetchQueries: [COURSE_SPACE, DASHBOARD, SEMESTERS, TASKS, DUE_SOON, ASSIGNMENTS] };
  const [share, { loading: sharing }] = useMutation<any>(SHARE_COURSE, opts);
  const [regen] = useMutation<any>(REGENERATE_CODE, opts);
  const [stop] = useMutation<any>(STOP_SHARING, opts);
  const [leave] = useMutation<any>(LEAVE_COURSE, opts);
  const [tab, setTab] = useState<"stream" | "assignments" | "people">("stream");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  // Same side panels as the dashboard
  const { data: dash } = useQuery<DashboardData>(DASHBOARD, { fetchPolicy: "cache-and-network" });
  const { data: semData } = useQuery<SemestersData>(SEMESTERS, { fetchPolicy: "cache-and-network" });
  const sem = dash?.dashboard.currentSemester ?? null;
  const semesterNav = sem && (
    <SemesterNav semesters={semData?.semesters ?? []} current={sem}
      onSelect={(sid) => navigate("/", { state: sid === sem.id ? null : { viewSemesterId: sid } })}
      onNew={() => navigate("/", { state: { newSemester: true } })} />
  );
  const sidePanel = dash ? <SemesterSummary shown={sem} courses={dash.dashboard.courses} /> : null;

  const s = data?.courseSpace;
  if (!s) {
    return (
      <AppShell
        main={loading ? <p className="text-slate-500">Loading…</p> : loadError ? (
          <LoadError what="course" onRetry={() => refetch()} />
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
            <p className="text-slate-600">This course doesn't exist.</p>
            <Link to="/" className="mt-3 inline-block font-medium underline">Back to dashboard</Link>
          </div>
        )}
        semesterNav={semesterNav}
        side={sidePanel}
      />
    );
  }

  const linked = s.shared && !s.isOwner; // a course you joined
  /** Run a mutation; show a payload error or network failure. Resolves true on success. */
  async function run(p: Promise<any>): Promise<boolean> {
    setError("");
    try {
      const { data: d } = await p;
      const errs = (d && (Object.values(d)[0] as any))?.errors;
      if (errs?.length) { setError(errs[0].message); return false; }
      return true;
    } catch (e) {
      console.error(e);
      setError("Something went wrong. Please try again.");
      return false;
    }
  }
  async function startSharing(mode: "classroom" | "group") {
    await run(share({ variables: { courseId: s!.courseId, mode } }));
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(s!.joinCode ?? ""); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  }

  return (
    <AppShell
      main={
        <div className="space-y-6">
          <header className="rounded-3xl bg-coral-400 p-6 text-plum-900 sm:p-8">
            <p className="text-sm font-semibold">{s.code}</p>
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{s.title}</h1>
            {s.shared && (
              <p className="mt-1 text-sm font-medium">
                {s.mode === "group" ? "Study group" : `Taught by ${s.teacher?.displayName}`} · {s.memberCount} {s.memberCount === 1 ? "person" : "people"}
              </p>
            )}
          </header>

          {(s.joinCode || s.role) && (
            <Card aria-label="Course details" className="flex flex-wrap items-center gap-x-8 gap-y-4">
              {s.joinCode && (
                <div>
                  <p className="text-xs font-semibold text-slate-500">Course code</p>
                  <p className="text-2xl font-extrabold tracking-widest">{s.joinCode}</p>
                </div>
              )}
              {s.role && (
                <div>
                  <p className="text-xs font-semibold text-slate-500">Your role</p>
                  <p className="text-sm font-semibold">{ROLE_LABEL[s.role]}</p>
                </div>
              )}
              <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
                {s.joinCode && (
                  <button onClick={copyCode} className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">
                    {copied ? "Copied" : "Copy code"}
                  </button>
                )}
                {s.joinCode && s.isOwner && (
                  <button onClick={() => { if (window.confirm("Make a new code? The old one stops working.")) run(regen({ variables: { courseId: s.courseId } })); }}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">New code</button>
                )}
                {s.shared && s.isOwner && (
                  <button onClick={() => {
                    if (window.confirm("Stop sharing? The stream and assignments are deleted and everyone keeps their own private copy of the course.")) run(stop({ variables: { courseId: s.courseId } }));
                  }} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 font-semibold text-red-600 hover:bg-red-50">Stop sharing</button>
                )}
                {linked && (
                  <Button variant="secondary" className="bg-white py-1.5 text-xs" onClick={async () => {
                    if (!window.confirm(`Leave ${s.code}? You keep the course, but it stops following the class.`)) return;
                    if (await run(leave({ variables: { courseId: s.courseId } }))) navigate("/");
                  }}>Leave class</Button>
                )}
              </div>
              {s.shared && error && <p role="alert" className="w-full text-xs text-red-700">{error}</p>}
            </Card>
          )}

          {!s.shared ? (
            <Card role="region" aria-label="Share this course" className="max-w-2xl">
              <h2 className="text-lg font-extrabold">This course is private</h2>
              {s.isOwner ? (
                <>
                  <p className="mt-1 text-sm text-slate-500">
                    Share it to get a code. People who join get this course in their own semester, plus a stream for announcements and comments.
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <button disabled={sharing} onClick={() => startSharing("classroom")}
                      className="rounded-xl border border-slate-300 p-4 text-left hover:border-plum-800 disabled:opacity-60">
                      <span className="font-semibold">Share as a classroom</span>
                      <span className="mt-1 block text-xs text-slate-500">You are the teacher. Only you post; others comment.</span>
                    </button>
                    <button disabled={sharing} onClick={() => startSharing("group")}
                      className="rounded-xl border border-slate-300 p-4 text-left hover:border-plum-800 disabled:opacity-60">
                      <span className="font-semibold">Share as a study group</span>
                      <span className="mt-1 block text-xs text-slate-500">Everyone is equal and can post.</span>
                    </button>
                  </div>
                  {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-500">This course is no longer shared by its owner.</p>
              )}
            </Card>
          ) : (
            <>
              <div role="tablist" aria-label="Course sections" className="flex gap-2">
                {([["stream", "Stream"], ["assignments", "Assignments"], ["people", `People ${s.memberCount}`]] as const).map(([key, label]) => (
                  <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                      tab === key ? "bg-plum-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {tab === "stream" ? (
                <Stream courseId={s.courseId} mode={s.mode ?? "classroom"} canPost={s.mode === "group" || s.isOwner} />
              ) : tab === "assignments" ? (
                <Assignments courseId={s.courseId} canAssign={s.mode === "group" || s.isOwner} />
              ) : (
                <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white shadow-sm">
                  {s.members.map((m) => (
                    <li key={m.user.id} className="flex items-center gap-3 p-4">
                      <Avatar name={m.user.displayName} url={m.user.avatarUrl} size={40} />
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold">{m.user.displayName}</p>
                      <span className="rounded-full bg-sun-300/60 px-2 py-0.5 text-xs font-medium">
                        {ROLE_LABEL[m.role as keyof typeof ROLE_LABEL] ?? m.role}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      }
      semesterNav={semesterNav}
      side={sidePanel}
    />
  );
}