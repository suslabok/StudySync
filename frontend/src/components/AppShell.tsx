import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@apollo/client/react";
import { useAuth } from "../auth/AuthContext";
import Avatar from "./Avatar";
import { DUE_SOON, dueLabel, isOverdue, type DueSoonData } from "../graphql/tasks";

const BUTTON = {
  primary: "bg-plum-800 text-white shadow-sm hover:bg-plum-900",
  secondary: "border border-slate-300 text-slate-700 hover:bg-slate-100",
  outline: "border border-plum-800 text-plum-900 hover:bg-white/30", // for the coral banner
} as const;

export function Button({
  variant = "primary", className = "", ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON }) {
  return (
    <button
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-60 ${BUTTON[variant]} ${className}`}
      {...rest}
    />
  );
}

/** Classes for a plain <input>/<select>/<textarea> outside TextField. */
export const fieldCls =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-plum-800 focus:outline-none focus:ring-2 focus:ring-sun-400";

export function Card({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-2xl border border-slate-100 bg-white p-6 shadow-sm ${className}`} {...rest} />;
}

export function Banner({ kind = "error", children }: { kind?: "error" | "ok"; children: ReactNode }) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={`rounded-lg px-3.5 py-2.5 text-sm ${kind === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"}`}
    >
      {children}
    </p>
  );
}

export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800">
      <p>Could not load your {what}.</p>
      <button onClick={onRetry} className="mt-3 font-medium underline">Try again</button>
    </div>
  );
}

export type ApiError = { field: string | null; message: string };

export function toFieldErrors(errs: ApiError[], fields: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of errs) {
    const key = e.field && fields.includes(e.field) ? e.field : "form";
    out[key] ??= e.message;
  }
  return out;
}

const DAY = 86_400_000;
const parseDate = (iso: string) => new Date(`${iso}T00:00:00`);
export const fmtDate = (iso: string) =>
  parseDate(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

type SemLite = { id: string; name: string; startDate: string; endDate: string };
type CourseLite = { id: string; code: string; color: string };

export function semesterStats(s: SemLite) {
  const start = parseDate(s.startDate).getTime();
  const end = parseDate(s.endDate).getTime();
  const now = Date.now();

  const totalDays = Math.max(1, Math.round((end - start) / DAY));
  const elapsedDays = Math.min(totalDays, Math.max(0, Math.round((now - start) / DAY)));
  const progress = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
  const daysLeft = Math.max(0, Math.ceil((end - now) / DAY));
  const notStarted = now < start;
  const ended = now > end;
  const timeLeftNote = notStarted
    ? `Starts ${fmtDate(s.startDate)}`
    : ended ? "Semester ended" : `Ends ${fmtDate(s.endDate)}`;

  return { totalDays, elapsedDays, progress, daysLeft, notStarted, ended, timeLeftNote };
}

const PATHS = {
  home: "M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 5v16",
  tasks: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9",
  timer: "M12 8v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  calendar: "M7 3v4M17 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
} as const;

/** Your logo. Put the image in /public and change this path if you rename it. */
const LOGO_SRC = "/logo.png";

function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

function NavItem({ icon, label, href, to, active, soon }: {
  icon: keyof typeof PATHS; label: string; href?: string; to?: string; active?: boolean; soon?: boolean;
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
  const cls = `${base} ${active ? "bg-white/10 text-sun-400" : "text-white/75 hover:bg-white/5 hover:text-white"}`;
  return (
    <li>
      {to ? (
        // Link, not <a href>: a normal link would reload the page
        <Link to={to} aria-current={active ? "page" : undefined} className={cls}>
          <Icon name={icon} /> {label}
        </Link>
      ) : (
        <a href={href} aria-current={active ? "page" : undefined} className={cls}>
          <Icon name={icon} /> {label}
        </a>
      )}
    </li>
  );
}

function Sidebar({ semesterNav }: { semesterNav?: ReactNode }) {
  const { signOut } = useAuth();
  const { pathname } = useLocation();
  const onDashboard = pathname === "/";
  const onCourses = pathname.startsWith("/courses"); // course detail pages keep "Courses" highlighted
  const onTasks = pathname.startsWith("/tasks");
  const onCalendar = pathname.startsWith("/calendar");
  const onFocus = pathname.startsWith("/focus");

  return (
    <aside className="hidden w-56 shrink-0 flex-col bg-plum-800 px-4 py-8 text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:self-start">
      <Link to="/" aria-label="StudySync home"
        className="flex items-center gap-2.5 rounded-xl px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-sun-400">
        <img src={LOGO_SRC} alt="" className="h-10 w-10 shrink-0 rounded-xl object-contain" />
        <span className="text-xl font-extrabold tracking-tight">StudySync</span>
      </Link>

      <nav aria-label="Main" className="mt-10">
        <ul className="space-y-1">
          {onDashboard
            ? <NavItem icon="home" label="Dashboard" href="#top" active />
            : <NavItem icon="home" label="Dashboard" to="/" />}
          <NavItem icon="book" label="Courses" to="/courses" active={onCourses} />
          <NavItem icon="tasks" label="Tasks" to="/tasks" active={onTasks} />
          <NavItem icon="timer" label="Focus timer" to="/focus" active={onFocus} />
          <NavItem icon="calendar" label="Calendar" to="/calendar" active={onCalendar} />
        </ul>
      </nav>

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto">{semesterNav}</div>

      <button onClick={signOut}
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/75 transition hover:bg-white/5 hover:text-white">
        <Icon name="logout" /> Log out
      </button>
    </aside>
  );
}

/* Mobile header account dropdown (was AccountsMenu.tsx) */
function AccountMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
      >
        <Avatar name={user?.displayName ?? ""} url={user?.avatarUrl} size={40} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-10 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-2 text-slate-900 shadow-lg">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium">{user?.displayName}</p>
            <p className="truncate text-xs text-slate-500">{user?.email}</p>
          </div>
          <Link role="menuitem" to="/profile" onClick={() => setOpen(false)}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100">
            Profile
          </Link>
          <button role="menuitem" onClick={signOut}
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100">
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

/** Top-right on desktop: photo + name, goes straight to the profile page. */
function ProfileLink() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const active = pathname.startsWith("/profile");
  return (
    <Link to="/profile" aria-label="Your profile" aria-current={active ? "page" : undefined}
      className={`flex min-w-0 max-w-full items-center gap-3 rounded-full py-1 pl-1 pr-4 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-800 ${
        active ? "bg-slate-100" : ""}`}>
      <Avatar name={user?.displayName ?? ""} url={user?.avatarUrl} size={44} />
      <span className="min-w-0 text-left leading-tight">
        <span className="block truncate text-sm font-bold">{user?.displayName}</span>
        <span className="block truncate text-xs text-slate-500">{user?.email}</span>
      </span>
    </Link>
  );
}

export function AppShell({ main, side, semesterNav }: {
  main: ReactNode;
  side?: ReactNode;
  semesterNav?: ReactNode;
}) {
  return (
    <div id="top" className="min-h-screen bg-white text-plum-900 lg:flex">
      <Sidebar semesterNav={semesterNav} />
      <header className="flex h-16 items-center justify-between bg-plum-800 px-4 text-white lg:hidden">
        <Link to="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <img src={LOGO_SRC} alt="" className="h-8 w-8 rounded-lg object-contain" />StudySync
        </Link>
        <AccountMenu />
      </header>
      <main className="min-w-0 flex-1 p-5 sm:p-8 lg:px-10 lg:py-8">{main}</main>
      <aside aria-label="Summary"
        className="shrink-0 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-80 lg:flex-col lg:self-start">
        {/* white strip with the profile, like the middle of the page; yellow starts below it */}
        <div className="hidden justify-end bg-white px-5 py-3 lg:flex"><ProfileLink /></div>
        <div className="bg-sun-300 p-5 sm:p-8 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:rounded-tl-3xl">
          {side}
        </div>
      </aside>
    </div>
  );
}

/** Left sidebar: list of semesters + "New semester". */
export function SemesterNav({ semesters, current, shownId, startingSemester = false, onSelect, onNew }: {
  semesters: SemLite[];
  current: SemLite;
  shownId?: string;               // highlighted semester (omit on pages that don't show one)
  startingSemester?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const list = semesters.length ? semesters : [current];
  return (
    <section aria-label="Semesters">
      <h2 className="px-3 text-xs font-semibold text-white/50">Semesters</h2>
      <ul className="mt-2 space-y-1">
        {list.map((t) => {
          const active = t.id === shownId;
          return (
            <li key={t.id}>
              <button
                onClick={() => onSelect(t.id)}
                aria-current={active ? "true" : undefined}
                className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                  active ? "bg-white/10 text-sun-400" : "text-white/75 hover:bg-white/5 hover:text-white"}`}>
                <span className="truncate">{t.name}</span>
                {t.id === current.id && (
                  <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px]">Current</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <button onClick={onNew}
        className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-white/75 transition hover:bg-white/5 hover:text-white">
        <span aria-hidden="true">{startingSemester ? "×" : "+"}</span> {startingSemester ? "Cancel" : "New semester"}
      </button>
    </section>
  );
}

/** A white card for the yellow side panel, with an optional progress bar. */
export function SideCard({ label, value, percent, note }: { label: string; value: string; percent?: number; note?: string }) {
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
      {note && <p className="mt-2 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

/** "Due soon" card for the yellow side panel. Shows a real error instead of an empty list. */
function DueSoon() {
  // task mutations refetch this by passing DUE_SOON in refetchQueries
  const { data, loading, error, refetch } = useQuery<DueSoonData>(DUE_SOON, { fetchPolicy: "cache-and-network" });
  const items = data?.dueSoon ?? [];
  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">Due soon</h3>
        <Link to="/tasks" className="text-xs underline">see all</Link>
      </div>
      {error && !data ? (
        <p role="alert" className="mt-3 text-sm">
          Could not load tasks.{" "}
          <button onClick={() => refetch()} className="font-medium underline">Try again</button>
        </p>
      ) : loading && !data ? (
        <p className="mt-3 text-sm" aria-busy="true">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm">Nothing due in the next 7 days.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((t) => (
            <li key={t.id} className="rounded-xl bg-white p-3 shadow-sm">
              <p className="truncate text-sm font-semibold">{t.title}</p>
              <p className={`mt-0.5 text-xs ${isOverdue(t) ? "font-semibold text-red-600" : "text-slate-500"}`}>
                {t.course ? `${t.course.code} · ` : ""}{dueLabel(t.dueDate)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Right (yellow) panel: course bubbles + progress cards. */
export function SemesterSummary({ shown, courses, viewed = false }: {
  shown: SemLite | null;
  courses: CourseLite[];
  viewed?: boolean;
}) {
  if (!shown) {
    return (
      <>
        <h2 className="text-xl font-extrabold">Semester</h2>
        <p className="mt-3 text-sm">Your progress and time left will appear here once you create a semester.</p>
      </>
    );
  }

  const { totalDays, elapsedDays, progress, daysLeft, timeLeftNote } = semesterStats(shown);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-extrabold">{viewed ? "Past semester" : "Semester"}</h2>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">Courses ({courses.length})</h3>
          <Link to="/courses" className="text-xs underline">see all</Link>
        </div>
        {courses.length === 0 ? (
          <p className="mt-3 text-sm">No courses yet.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-4">
            {courses.slice(0, 4).map((c) => (
              <li key={c.id} className="w-14">
                <Link to={`/courses/${c.id}`} aria-label={`Open ${c.code}`} className="flex flex-col items-center text-center">
                  <span className="grid h-11 w-11 place-items-center rounded-full text-xs font-bold text-white ring-2 ring-white"
                    style={{ backgroundColor: c.color }} aria-hidden="true">
                    {c.code.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="mt-1 w-full truncate text-[11px] font-medium">{c.code}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!viewed && <DueSoon />}

      <div>
        <h3 className="text-sm font-bold">Your progress</h3>
        <div className="mt-3 space-y-3">
          <SemesterStatsCards progress={progress} elapsedDays={elapsedDays} totalDays={totalDays}
            daysLeft={daysLeft} timeLeftNote={timeLeftNote} count={courses.length} name={shown.name} />
        </div>
      </div>
    </div>
  );
}

function SemesterStatsCards({ progress, elapsedDays, totalDays, daysLeft, timeLeftNote, count, name }: {
  progress: number; elapsedDays: number; totalDays: number; daysLeft: number;
  timeLeftNote: string; count: number; name: string;
}) {
  return (
    <>
      <SideCard label="Semester progress" value={`${progress}%`} percent={progress}
        note={`${elapsedDays} of ${totalDays} days`} />
      <SideCard label="Time left" value={`${daysLeft}d`} percent={100 - progress} note={timeLeftNote} />
      <SideCard label="Courses" value={String(count)} note={name} />
    </>
  );
}