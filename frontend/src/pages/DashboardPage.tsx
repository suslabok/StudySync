import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@apollo/client/react";
import { useAuth } from "../auth/AuthContext";
import { DASHBOARD, SEMESTERS, type DashboardData, type SemestersData } from "../graphql/dashboard";
import {
  AppShell, Button, Card, LoadError, SemesterNav, SemesterSummary,
  fmtDate as fmt, semesterStats,
} from "../components/AppShell";
import CourseCard from "../components/CourseCard";
import { JoinCourseForm } from "../components/CourseSharing";
import CourseForm from "../components/CourseForm";
import SemesterForm from "../components/SemesterForm";

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 text-center shadow-sm">
      <p className="text-2xl font-extrabold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, error, refetch } = useQuery<DashboardData>(DASHBOARD, { fetchPolicy: "cache-and-network" });
  const { data: semData } = useQuery<SemestersData>(SEMESTERS, { fetchPolicy: "cache-and-network" });
  const [adding, setAdding] = useState(false);
  const [joining, setJoining] = useState(false);

  // The Profile page can send us here to open a past semester or the "new semester" form
  const nav = useLocation().state as { viewSemesterId?: string; newSemester?: boolean } | null;
  const [startingSemester, setStartingSemester] = useState(!!nav?.newSemester);
  const [editingSemester, setEditingSemester] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(nav?.viewSemesterId ?? null);

  const currentId = data?.dashboard.currentSemester?.id;
  const prevId = useRef(currentId);
  useEffect(() => {
    // A different semester replaced the current one: close the forms and leave any past semester
    if (prevId.current && prevId.current !== currentId) {
      setStartingSemester(false); setEditingSemester(false); setViewingId(null);
    }
    prevId.current = currentId;
  }, [currentId]);

  const firstName = user?.displayName.split(" ")[0] ?? "";
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  if (!data) {
    return (
      <AppShell
        main={error
          ? <LoadError what="dashboard" onRetry={() => refetch()} />
          : <p className="text-slate-500">Loading…</p>}
        side={null}
      />
    );
  }

  const { currentSemester: sem, courses } = data.dashboard;

  if (!sem) {
    return (
      <AppShell
        main={
          <div className="max-w-md">
            <h1 className="text-2xl font-extrabold tracking-tight">Welcome, {firstName}!</h1>
            <p className="mt-1 text-sm text-slate-500">{today}</p>
            <p className="mt-6 text-slate-600">Start by setting up your current semester.</p>
            <Card className="mt-4"><SemesterForm /></Card>
          </div>
        }
        side={<SemesterSummary shown={null} courses={[]} />}
      />
    );
  }

  const semesters = semData?.semesters ?? [];
  const viewed = viewingId && viewingId !== sem.id
    ? semesters.find((s) => s.id === viewingId) ?? null : null;
  const shown = viewed ?? sem;
  const shownCourses = viewed ? viewed.courses : courses;

  const { progress, daysLeft, notStarted, ended } = semesterStats(shown);
  const banner = viewed
    ? `${shown.name} (${fmt(shown.startDate)} to ${fmt(shown.endDate)}). You are viewing a past semester, so it is read-only.`
    : notStarted ? `${shown.name} starts on ${fmt(shown.startDate)}. Get your courses ready.`
    : ended ? `${shown.name} has ended. Time to set up the next one.`
    : `${shown.name} is ${progress}% done with ${daysLeft} days to go. Keep it up!`;

  const semesterNavItems = (
    <SemesterNav semesters={semesters} current={sem} shownId={shown.id}
      startingSemester={startingSemester}
      onSelect={(id) => setViewingId(id === sem.id ? null : id)}
      onNew={() => setStartingSemester((v) => !v)} />
  );

  return (
    <AppShell
      semesterNav={semesterNavItems}
      main={
        <div className="space-y-8">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Welcome back, {firstName}!</h1>
              <p className="mt-1 text-sm text-slate-500">{today}</p>
            </div>
            <div className="flex items-center gap-2 lg:hidden">
              {semesters.length > 1 && (
                <>
                  <label htmlFor="semester" className="sr-only">Semester</label>
                  <select id="semester" value={shown.id}
                    onChange={(e) => setViewingId(e.target.value === sem.id ? null : e.target.value)}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium">
                    {semesters.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}{s.id === sem.id ? " (current)" : ""}</option>
                    ))}
                  </select>
                </>
              )}
              <Button onClick={() => setStartingSemester((v) => !v)}>
                {startingSemester ? "Cancel" : "New semester"}
              </Button>
            </div>
          </header>

          {startingSemester && (
            <Card role="region" aria-label="New semester" className="max-w-md">
              <h2 className="text-lg font-extrabold">Start a new semester</h2>
              <p className="mb-4 mt-1 text-sm text-slate-500">
                {sem.name} moves to your past semesters. Its courses stay with it, and you can open it from Semesters in the sidebar.
              </p>
              <SemesterForm />
            </Card>
          )}

          {editingSemester && !viewed && !startingSemester && (
            <Card role="region" aria-label="Edit semester" className="max-w-md">
              <h2 className="mb-4 text-lg font-extrabold">Edit semester</h2>
              <SemesterForm key={sem.id} semester={sem} onDone={() => setEditingSemester(false)} />
            </Card>
          )}

          <section className="rounded-3xl bg-coral-400 p-6 text-plum-900 sm:p-8" aria-label="Semester status">
            <h2 className="text-2xl font-extrabold">{viewed ? "Past semester" : "Good job!"}</h2>
            <p className="mt-2 max-w-md text-sm font-medium">{banner}</p>
            {ended && !viewed && !startingSemester && (
              <Button className="mr-2 mt-4" onClick={() => setStartingSemester(true)}>Start new semester</Button>
            )}
            {!viewed && !editingSemester && (
              <Button variant="outline" className="mt-4"
                onClick={() => { setStartingSemester(false); setEditingSemester(true); }}>
                Edit semester
              </Button>
            )}
            {viewed && (
              <Button className="mt-4" onClick={() => setViewingId(null)}>Back to {sem.name}</Button>
            )}
          </section>

          <section className="grid grid-cols-3 gap-3 sm:gap-4" aria-label="Overview">
            <StatTile value={`${progress}%`} label="Progress" />
            <StatTile value={String(daysLeft)} label="Days left" />
            <StatTile value={String(shownCourses.length)} label="Courses" />
          </section>

          <section id="courses" aria-labelledby="courses-heading" className="scroll-mt-6">
            <div className="flex items-center justify-between">
              <h2 id="courses-heading" className="text-xl font-extrabold">Your courses</h2>
              {!adding && !joining && !viewed && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setJoining(true)}>Join with code</Button>
                  <Button onClick={() => setAdding(true)}>Add course</Button>
                </div>
              )}
            </div>

            {adding && !viewed && (
              <Card className="mt-4"><CourseForm onDone={() => setAdding(false)} /></Card>
            )}

            {joining && !viewed && (
              <Card className="mt-4 max-w-md"><JoinCourseForm onDone={() => setJoining(false)} /></Card>
            )}

            {shownCourses.length === 0 && !adding ? (
              <p className="mt-4 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                {viewed ? "No courses in this semester." : "No courses yet. Add your first course to get started."}
              </p>
            ) : (
              <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                {shownCourses.map((c) => <CourseCard key={c.id} course={c} readOnly={!!viewed} />)}
              </ul>
            )}
          </section>
        </div>
      }
      side={<SemesterSummary shown={shown} courses={shownCourses} viewed={!!viewed} />}
    />
  );
}