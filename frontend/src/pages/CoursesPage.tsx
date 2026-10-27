import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@apollo/client/react";
import {
  AppShell, Button, Card, LoadError, SemesterNav, SemesterSummary, fmtDate,
} from "../components/AppShell";
import CourseCard from "../components/CourseCard";
import CourseForm from "../components/CourseForm";
import { JoinCourseForm } from "../components/CourseSharing";
import { DASHBOARD, SEMESTERS, type DashboardData, type SemestersData } from "../graphql/dashboard";

/** Sidebar "Courses": every course, current semester first. Each card opens /courses/:id. */
export default function CoursesPage() {
  const navigate = useNavigate();
  const { data, error, refetch } = useQuery<DashboardData>(DASHBOARD, { fetchPolicy: "cache-and-network" });
  const { data: semData } = useQuery<SemestersData>(SEMESTERS, { fetchPolicy: "cache-and-network" });
  const [adding, setAdding] = useState(false);
  const [joining, setJoining] = useState(false);

  const sem = data?.dashboard.currentSemester ?? null;
  const semesters = semData?.semesters ?? [];
  const semesterNav = sem && (
    <SemesterNav semesters={semesters} current={sem}
      onSelect={(id) => navigate("/", { state: id === sem.id ? null : { viewSemesterId: id } })}
      onNew={() => navigate("/", { state: { newSemester: true } })} />
  );

  if (!data) {
    return (
      <AppShell
        semesterNav={semesterNav}
        main={error ? <LoadError what="courses" onRetry={() => refetch()} /> : <p className="text-slate-500">Loading…</p>}
        side={null}
      />
    );
  }

  const courses = data.dashboard.courses;
  const past = semesters.filter((s) => s.id !== sem?.id && s.courses.length > 0);

  return (
    <AppShell
      semesterNav={semesterNav}
      side={<SemesterSummary shown={sem} courses={courses} />}
      main={
        <div className="space-y-8">
          <header>
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Courses</h1>
            <p className="mt-1 text-sm text-slate-500">Open a course to see its stream, people and sharing.</p>
          </header>

          {!sem ? (
            <Card className="max-w-md">
              <p className="text-slate-600">Set up a semester first, then add your courses.</p>
              <Link to="/" className="mt-3 inline-block font-medium underline">Go to dashboard</Link>
            </Card>
          ) : (
            <section aria-labelledby="current-heading">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="current-heading" className="text-xl font-extrabold">
                  {sem.name} <span className="text-sm font-medium text-slate-500">· current</span>
                </h2>
                {!adding && !joining && (
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setJoining(true)}>Join with code</Button>
                    <Button onClick={() => setAdding(true)}>Add course</Button>
                  </div>
                )}
              </div>

              {adding && <Card className="mt-4"><CourseForm onDone={() => setAdding(false)} /></Card>}
              {joining && <Card className="mt-4 max-w-md"><JoinCourseForm onDone={() => setJoining(false)} /></Card>}

              {courses.length === 0 && !adding ? (
                <p className="mt-4 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                  No courses yet. Add your first course to get started.
                </p>
              ) : (
                <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                  {courses.map((c) => <CourseCard key={c.id} course={c} />)}
                </ul>
              )}
            </section>
          )}

          {past.map((s) => (
            <section key={s.id} aria-label={s.name}>
              <h2 className="text-lg font-extrabold">
                {s.name}{" "}
                <span className="text-sm font-medium text-slate-500">· {fmtDate(s.startDate)} to {fmtDate(s.endDate)}</span>
              </h2>
              <ul className="mt-3 grid gap-4 sm:grid-cols-2">
                {s.courses.map((c) => <CourseCard key={c.id} course={c} readOnly />)}
              </ul>
            </section>
          ))}
        </div>
      }
    />
  );
}