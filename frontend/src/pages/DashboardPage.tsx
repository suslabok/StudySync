import { useState, type ReactNode } from "react";
import { useQuery } from "@apollo/client/react";
import { useAuth } from "../auth/AuthContext";
import { DASHBOARD, type DashboardData } from "../graphql/dashboard";
import AccountMenu from "../components/AccountsMenu";
import CourseCard from "../components/CourseCard";
import CourseForm from "../components/CourseForm";
import SemesterForm from "../components/SemesterForm";

const DAY = 86_400_000;
const parse = (iso: string) => new Date(`${iso}T00:00:00`);
const fmt = (iso: string) =>
  parse(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

const PATHS = {
  home: "M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 5v16",
  tasks: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9",
  timer: "M12 8v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  calendar: "M7 3v4M17 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
} as const;

function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/* sidebar */
function NavItem({ icon, label, href, active, soon }: {
  icon: keyof typeof PATHS; label: string; href?: string; active?: boolean; soon?: boolean;
}) {
  const base = "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition";
  if (soon) {
    return (
      <li>
        <span aria-disabled="true" className={`${base} cursor-not-allowed text-white/40`}>
          <Icon name={icon} /> {label}
          <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide">Soon</span>
        </span>
      </li>
    );
  }
  return (
    <li>
      <a href={href} aria-current={active ? "page" : undefined}
        className={`${base} ${active ? "bg-white/10 text-sun-400" : "text-white/75 hover:bg-white/5 hover:text-white"}`}>
        <Icon name={icon} /> {label}
      </a>
    </li>
  );
}

function Sidebar() {
  const { user, signOut } = useAuth();
  return (
    <aside className="hidden w-56 shrink-0 flex-col bg-plum-800 px-4 py-8 text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:self-start">
      <div className="flex flex-col items-center text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-sun-400 to-coral-400 text-xl font-bold text-plum-900">
          {initials(user?.displayName ?? "")}
        </span>
        <p className="mt-3 max-w-full truncate text-sm font-semibold">{user?.displayName}</p>
        <p className="max-w-full truncate text-xs text-white/60">{user?.email}</p>
      </div>

      <nav aria-label="Main" className="mt-10 flex-1">
        <ul className="space-y-1">
          <NavItem icon="home" label="Dashboard" href="#top" active />
          <NavItem icon="book" label="Courses" href="#courses" />
          <NavItem icon="tasks" label="Tasks" soon />
          <NavItem icon="timer" label="Focus timer" soon />
          <NavItem icon="calendar" label="Calendar" soon />
        </ul>
      </nav>

      <button onClick={signOut}
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/75 transition hover:bg-white/5 hover:text-white">
        <Icon name="logout" /> Log out
      </button>
    </aside>
  );
}

/* layout frame */
function Frame({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div id="top" className="min-h-screen bg-white text-plum-900 lg:flex">
      <Sidebar />
      <header className="flex h-16 items-center justify-between bg-plum-800 px-4 text-white lg:hidden">
        <span className="text-lg font-semibold tracking-tight">StudySync</span>
        <AccountMenu />
      </header>
      <main className="min-w-0 flex-1 p-5 sm:p-8 lg:px-10 lg:py-8">{main}</main>
      <aside
        className="shrink-0 bg-sun-300 p-5 sm:p-8 lg:sticky lg:top-0 lg:h-screen lg:w-80 lg:self-start lg:overflow-y-auto"
        aria-label="Semester summary"
      >
        {side}
      </aside>
    </div>
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 text-center shadow-sm">
      <p className="text-2xl font-extrabold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
    </div>
  );
}

function ProgressCard({ label, value, percent, note }: { label: string; value: string; percent?: number; note: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-lg font-extrabold">{value}</p>
      </div>
      {percent !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sun-300/50"
          role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
          <div className="h-full rounded-full bg-sun-400" style={{ width: `${percent}%` }} />
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">{note}</p>
    </div>
  );
}

/* page */
export default function DashboardPage() {
  const { user } = useAuth();
  const { data, error, refetch } = useQuery<DashboardData>(DASHBOARD, { fetchPolicy: "cache-and-network" });
  const [adding, setAdding] = useState(false);
  const firstName = user?.displayName.split(" ")[0] ?? "";
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  if (!data) {
    return (
      <Frame
        main={
          error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800">
              <p>Could not load your dashboard.</p>
              <button onClick={() => refetch()} className="mt-3 font-medium underline">Try again</button>
            </div>
          ) : (
            <p className="text-slate-500">Loading…</p>
          )
        }
        side={null}
      />
    );
  }

  const { currentSemester: sem, courses } = data.dashboard;

  if (!sem) {
    return (
      <Frame
        main={
          <div className="max-w-md">
            <h1 className="text-2xl font-extrabold tracking-tight">Welcome, {firstName}!</h1>
            <p className="mt-1 text-sm text-slate-500">{today}</p>
            <p className="mt-6 text-slate-600">Start by setting up your current semester.</p>
            <div className="mt-4 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <SemesterForm />
            </div>
          </div>
        }
        side={
          <>
            <h2 className="text-xl font-extrabold">Semester</h2>
            <p className="mt-3 text-sm">Your progress and time left will appear here once you create a semester.</p>
          </>
        }
      />
    );
  }

  const start = parse(sem.startDate).getTime();
  const end = parse(sem.endDate).getTime();
  const now = Date.now();
  const totalDays = Math.max(1, Math.round((end - start) / DAY));
  const elapsedDays = Math.min(totalDays, Math.max(0, Math.round((now - start) / DAY)));
  const progress = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
  const daysLeft = Math.max(0, Math.ceil((end - now) / DAY));
  const timeLeftNote = now < start ? `Starts ${fmt(sem.startDate)}` : now > end ? "Semester ended" : `Ends ${fmt(sem.endDate)}`;
  const banner =
    now < start ? `${sem.name} starts on ${fmt(sem.startDate)}. Get your courses ready.`
    : now > end ? `${sem.name} has ended. Time to set up the next one.`
    : `${sem.name} is ${progress}% done with ${daysLeft} days to go. Keep it up!`;

  return (
    <Frame
      main={
        <div className="space-y-8">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Welcome back, {firstName}!</h1>
              <p className="mt-1 text-sm text-slate-500">{today}</p>
            </div>
          </header>

          <section className="rounded-3xl bg-coral-400 p-6 text-plum-900 sm:p-8" aria-label="Semester status">
            <h2 className="text-2xl font-extrabold">Good job!</h2>
            <p className="mt-2 max-w-md text-sm font-medium">{banner}</p>
          </section>

          <section className="grid grid-cols-3 gap-3 sm:gap-4" aria-label="Overview">
            <StatTile value={`${progress}%`} label="Progress" />
            <StatTile value={String(daysLeft)} label="Days left" />
            <StatTile value={String(courses.length)} label="Courses" />
          </section>

          <section id="courses" aria-labelledby="courses-heading" className="scroll-mt-6">
            <div className="flex items-center justify-between">
              <h2 id="courses-heading" className="text-xl font-extrabold">Your courses</h2>
              {!adding && (
                <button onClick={() => setAdding(true)}
                  className="rounded-xl bg-plum-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-plum-900">
                  Add course
                </button>
              )}
            </div>

            {adding && (
              <div className="mt-4 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
                <CourseForm onDone={() => setAdding(false)} />
              </div>
            )}

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
        </div>
      }
      side={
        <div className="space-y-6">
          <h2 className="text-xl font-extrabold">Semester</h2>

          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">Courses ({courses.length})</h3>
              <a href="#courses" className="text-xs underline">see all</a>
            </div>
            {courses.length === 0 ? (
              <p className="mt-3 text-sm">No courses yet.</p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-4">
                {courses.slice(0, 4).map((c) => (
                  <li key={c.id} className="flex w-14 flex-col items-center text-center">
                    <span className="grid h-11 w-11 place-items-center rounded-full text-xs font-bold text-white ring-2 ring-white"
                      style={{ backgroundColor: c.color }} aria-hidden="true">
                      {c.code.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="mt-1 w-full truncate text-[11px] font-medium">{c.code}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-sm font-bold">Your progress</h3>
            <div className="mt-3 space-y-3">
              <ProgressCard label="Semester progress" value={`${progress}%`} percent={progress}
                note={`${elapsedDays} of ${totalDays} days`} />
              <ProgressCard label="Time left" value={`${daysLeft}d`} percent={100 - progress} note={timeLeftNote} />
              <ProgressCard label="Courses" value={String(courses.length)} note={sem.name} />
            </div>
          </div>
        </div>
      }
    />
  );
}