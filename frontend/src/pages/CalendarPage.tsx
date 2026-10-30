import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@apollo/client/react";
import NepaliDate from "nepali-date-converter";
import { AppShell, Button, Card, LoadError, SemesterNav, SemesterSummary, fieldCls } from "../components/AppShell";
import { TaskForm } from "../components/TaskWidgets";
import {
  CREATE_EVENT, DELETE_EVENT, EVENTS, HOLIDAYS, HOLIDAY_COUNTRIES, KINDS, UPDATE_EVENT,
  type CalendarEvent, type EventKind, type Holiday,
} from "../graphql/agenda";
import { DASHBOARD, SEMESTERS, type DashboardData, type SemestersData } from "../graphql/dashboard";
import { TASKS, dueLabel, isOverdue, type Task, type TasksData } from "../graphql/tasks";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 3;
const HOLIDAY_COLOR = "#a8741a";
const SEMESTER_COLOR = "#4b3f5f";
const TASK_COLOR = "#64748b";

/** YYYY-MM-DD in local time, the same format the API uses. */
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (key: string) => new Date(`${key}T00:00:00`);
const longDay = (key: string) => parse(key).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
const shortDay = (key: string) => parse(key).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/* ---- Bikram Sambat (the Nepali calendar) ---- */

const BS_MONTHS = ["बैशाख", "जेठ", "असार", "श्रावण", "भदौ", "आश्विन", "कार्तिक", "मंसिर", "पौष", "माघ", "फागुन", "चैत"];
const nepaliDigits = (n: number) => String(n).replace(/\d/g, (c) => "०१२३४५६७८९"[Number(c)]);

/** The Nepali date of an English one, or null outside the range the converter knows (about 1913 to 2043). */
function toBS(d: Date): { y: number; m: number; d: number } | null {
  try {
    const n = new NepaliDate(d);
    return { y: n.getYear(), m: n.getMonth(), d: n.getDate() };
  } catch {
    return null;
  }
}
const bsLong = (d: Date) => {
  const b = toBS(d);
  return b ? `${nepaliDigits(b.d)} ${BS_MONTHS[b.m]} ${nepaliDigits(b.y)}` : "";
};

/** A small value kept in localStorage; works without it (private windows). */
function useSaved(key: string, initial: () => string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    try { const v = localStorage.getItem(key); return v === null ? initial() : v; } catch { return initial(); }
  });
  return [value, (v) => {
    setValue(v);
    try { localStorage.setItem(key, v); } catch { /* not remembered */ }
  }];
}

/** The 6 weeks (42 days) shown for a month, starting on the Sunday on or before the 1st. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

const TZ_COUNTRY: Record<string, string> = {
  "Asia/Katmandu": "NP", "Asia/Kathmandu": "NP", "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Dhaka": "BD",
  "Asia/Karachi": "PK", "Asia/Colombo": "LK", "Asia/Singapore": "SG", "Asia/Dubai": "AE", "Asia/Tokyo": "JP",
  "Europe/London": "GB", "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Pacific/Auckland": "NZ",
};

/** A first guess at the viewer's country: their time zone, then their browser language. */
function guessCountry(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TZ_COUNTRY[tz]) return TZ_COUNTRY[tz];
    return new Intl.Locale(navigator.language).maximize().region ?? "";
  } catch {
    return "";
  }
}

const countryName = (code: string) => {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code; } catch { return code; }
};

const statusNote = (t: Task) =>
  t.status === "done" ? (t.assigned ? "Handed in" : "Done")
    : isOverdue(t) ? "Overdue" : t.assigned ? "To hand in" : t.status === "doing" ? "In progress" : "To do";

type Entry = { key: string; label: string; color: string; kind: "holiday" | "semester" | "event" | "task"; done?: boolean };

/* ------------------------------------------------------------------ */
/* the form for your own events                                       */
/* ------------------------------------------------------------------ */

function EventForm({ event, date, onDone }: { event?: CalendarEvent; date: string; onDone: () => void }) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [kind, setKind] = useState<EventKind>(event?.kind ?? "event");
  const [startDate, setStartDate] = useState(event?.startDate ?? date);
  const [endDate, setEndDate] = useState(event?.endDate ?? "");
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [create, c1] = useMutation<any>(CREATE_EVENT, { refetchQueries: [EVENTS] });
  const [update, c2] = useMutation<any>(UPDATE_EVENT, { refetchQueries: [EVENTS] });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    const input = { title, kind, startDate, endDate: endDate || null, notes: notes || null };
    try {
      const { data } = event
        ? await update({ variables: { id: event.id, input } })
        : await create({ variables: { input } });
      const errs = (event ? data?.updateEvent : data?.createEvent)?.errors ?? [];
      if (errs.length) {
        const next: Record<string, string> = {};
        for (const er of errs) next[er.field ?? "form"] ??= er.message;
        return setErrors(next);
      }
      onDone();
    } catch {
      setErrors({ form: "Something went wrong. Please try again." });
    }
  }

  const err = (k: string) => errors[k] && <p className="mt-1 text-xs text-red-600">{errors[k]}</p>;
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="ev-title" className="text-sm font-medium">Title</label>
          <input id="ev-title" className={fieldCls} value={title} placeholder="e.g. Maths midterm" autoFocus
            onChange={(e) => setTitle(e.target.value)} />
          {err("title")}
        </div>
        <div>
          <label htmlFor="ev-kind" className="text-sm font-medium">Type</label>
          <select id="ev-kind" className={fieldCls} value={kind} onChange={(e) => setKind(e.target.value as EventKind)}>
            {(Object.keys(KINDS) as EventKind[]).map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
          </select>
          {err("kind")}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ev-start" className="text-sm font-medium">Date</label>
          <input id="ev-start" type="date" className={fieldCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          {err("startDate")}
        </div>
        <div>
          <label htmlFor="ev-end" className="text-sm font-medium">Until <span className="text-slate-400">(optional, for several days)</span></label>
          <input id="ev-end" type="date" className={fieldCls} value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          {err("endDate")}
        </div>
      </div>
      <div>
        <label htmlFor="ev-notes" className="text-sm font-medium">Notes <span className="text-slate-400">(optional)</span></label>
        <textarea id="ev-notes" rows={2} className={fieldCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {err("notes")}
      </div>
      {err("form")}
      <div className="flex gap-2">
        <Button disabled={c1.loading || c2.loading}>{event ? "Save changes" : "Add event"}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* the page                                                           */
/* ------------------------------------------------------------------ */

export default function CalendarPage() {
  const navigate = useNavigate();
  const today = new Date();
  const todayKey = iso(today);
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selected, setSelected] = useState(todayKey);
  const [adding, setAdding] = useState<"task" | "event" | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [country, setCountry] = useSaved("studysync.holidayCountry", guessCountry);   // "" = no holidays
  const [bsOn, setBsOn] = useSaved("studysync.nepaliDates", () => (guessCountry() === "NP" ? "1" : ""));
  const [holidayLang, setHolidayLang] = useSaved("studysync.holidayLang", () => "en_US");
  const [show, setShow] = useState({ tasks: true, holidays: true, events: true });

  const days = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const from = iso(days[0]);
  const to = iso(days[41]);
  const years = [...new Set([days[0].getFullYear(), days[41].getFullYear()])];

  const { data: taskData, error, refetch } = useQuery<TasksData>(TASKS, { fetchPolicy: "cache-and-network" });
  const { data: eventData } = useQuery<{ events: CalendarEvent[] }>(EVENTS, { variables: { from, to }, fetchPolicy: "cache-and-network" });
  const { data: countryData } = useQuery<{ holidayCountries: string[] }>(HOLIDAY_COUNTRIES);
  const h1 = useQuery<{ holidays: Holiday[] }>(HOLIDAYS, { variables: { country, year: years[0], language: holidayLang }, skip: !country });
  const h2 = useQuery<{ holidays: Holiday[] }>(HOLIDAYS, { variables: { country, year: years[1], language: holidayLang }, skip: !country || years.length < 2 });
  const [removeEvent] = useMutation<any>(DELETE_EVENT, { refetchQueries: [EVENTS] });

  // same side panels as the dashboard
  const { data: dash } = useQuery<DashboardData>(DASHBOARD, { fetchPolicy: "cache-and-network" });
  const { data: semData } = useQuery<SemestersData>(SEMESTERS, { fetchPolicy: "cache-and-network" });
  const sem = dash?.dashboard.currentSemester ?? null;
  const semesterNav = sem && (
    <SemesterNav semesters={semData?.semesters ?? []} current={sem}
      onSelect={(sid) => navigate("/", { state: sid === sem.id ? null : { viewSemesterId: sid } })}
      onNew={() => navigate("/", { state: { newSemester: true } })} />
  );

  // everything that happens on each day, as one lookup
  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    const add = (day: string, e: Entry) => map.set(day, [...(map.get(day) ?? []), e]);

    if (show.holidays) {
      for (const h of [...(h1.data?.holidays ?? []), ...(h2.data?.holidays ?? [])]) {
        add(h.date, { key: `h-${h.date}-${h.name}`, label: h.name, color: HOLIDAY_COLOR, kind: "holiday" });
      }
    }
    for (const s of semData?.semesters ?? []) {
      add(s.startDate, { key: `ss-${s.id}`, label: `${s.name} starts`, color: SEMESTER_COLOR, kind: "semester" });
      add(s.endDate, { key: `se-${s.id}`, label: `${s.name} ends`, color: SEMESTER_COLOR, kind: "semester" });
    }
    if (show.events) {
      for (const ev of eventData?.events ?? []) {
        const last = ev.endDate ?? ev.startDate;
        for (const d of days) {
          const k = iso(d);
          if (k >= ev.startDate && k <= last) add(k, { key: `e-${ev.id}-${k}`, label: ev.title, color: KINDS[ev.kind].color, kind: "event" });
        }
      }
    }
    if (show.tasks) {
      for (const t of taskData?.tasks ?? []) {
        if (t.dueDate) add(t.dueDate, { key: `t-${t.id}`, label: t.title, color: t.course?.color ?? TASK_COLOR, kind: "task", done: t.status === "done" });
      }
    }
    return map;
  }, [show, h1.data, h2.data, semData, eventData, taskData, days]);

  const bsDays = useMemo(() => {
    const map = new Map<string, string>();
    if (!bsOn) return map;
    for (const d of days) {
      const b = toBS(d);
      if (b) map.set(iso(d), b.d === 1 ? `${nepaliDigits(1)} ${BS_MONTHS[b.m]}` : nepaliDigits(b.d));
    }
    return map;
  }, [bsOn, days]);

  // e.g. "कार्तिक – मंसिर २०८३" for the days of the month being shown
  const bsTitle = useMemo(() => {
    if (!bsOn) return "";
    const first = toBS(new Date(cursor.year, cursor.month, 1));
    const last = toBS(new Date(cursor.year, cursor.month + 1, 0));
    if (!first || !last) return "";
    const months = first.m === last.m ? BS_MONTHS[first.m] : `${BS_MONTHS[first.m]} – ${BS_MONTHS[last.m]}`;
    return `${months} ${nepaliDigits(last.y)}`;
  }, [bsOn, cursor]);

  const weekend = country === "NP" ? [6] : [0, 6];     // Nepal's weekly holiday is Saturday
  const title = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const undated = (taskData?.tasks ?? []).filter((t) => !t.dueDate && t.status !== "done").length;


  const countries = useMemo(
    () => (countryData?.holidayCountries ?? []).map((c) => ({ code: c, name: countryName(c) })).sort((a, b) => a.name.localeCompare(b.name)),
    [countryData],
  );

  function go(delta: number) {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  }
  function pick(d: Date) {
    setSelected(iso(d));
    setAdding(null);
    setEditingEventId(null);
    if (d.getMonth() !== cursor.month) setCursor({ year: d.getFullYear(), month: d.getMonth() });
  }
  // the selected day, split by kind
  const dayHolidays = (byDay.get(selected) ?? []).filter((e) => e.kind === "holiday");
  const dayMarkers = (byDay.get(selected) ?? []).filter((e) => e.kind === "semester");
  const dayEvents = (eventData?.events ?? []).filter((ev) => show.events && selected >= ev.startDate && selected <= (ev.endDate ?? ev.startDate));
  const dayTasks = show.tasks ? (taskData?.tasks ?? []).filter((t) => t.dueDate === selected) : [];
  const nothing = !dayHolidays.length && !dayMarkers.length && !dayEvents.length && !dayTasks.length;

  const toggles: [keyof typeof show, string, string][] = [
    ["tasks", "Tasks", TASK_COLOR], ["holidays", "Holidays", HOLIDAY_COLOR], ["events", "My events", KINDS.event.color],
  ];

  return (
    <AppShell
      semesterNav={semesterNav}
      side={dash ? <SemesterSummary shown={sem} courses={dash.dashboard.courses} /> : null}
      main={
        <div className="space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Calendar</h1>
              {undated > 0 && (
                <p className="mt-1 text-sm text-slate-500">
                  <Link to="/tasks" className="underline">{undated} open task{undated === 1 ? "" : "s"} without a date</Link>
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => go(-1)} aria-label="Previous month">‹</Button>
              <Button variant="secondary" onClick={() => go(1)} aria-label="Next month">›</Button>
            </div>
          </header>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Show on the calendar">
              {toggles.map(([key, label, color]) => (
                <button key={key} type="button" aria-pressed={show[key]} onClick={() => setShow({ ...show, [key]: !show[key] })}
                  style={{ "--c": color } as CSSProperties}
                  className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${
                    show[key] ? "border-(--c) bg-[color-mix(in_srgb,var(--c)_14%,white)] text-plum-900" : "border-transparent bg-slate-100 text-slate-400"}`}>
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: show[key] ? color : "#cbd5e1" }} />
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" aria-pressed={!!bsOn} onClick={() => setBsOn(bsOn ? "" : "1")}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                  bsOn ? "border-plum-800 bg-plum-800 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                <span lang="ne">नेपाली मिति</span>
              </button>
              {country === "NP" && (
                <button type="button" aria-pressed={holidayLang === "ne"}
                  onClick={() => setHolidayLang(holidayLang === "ne" ? "en_US" : "ne")}
                  className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                    holidayLang === "ne" ? "border-plum-800 bg-plum-800 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                  <span lang="ne">बिदाको नाम नेपालीमा</span>
                </button>
              )}
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <select value={country} onChange={(e) => setCountry(e.target.value)}
                className="max-w-48 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium">
                <option value="">None</option>
                {country && !countries.some((c) => c.code === country) && <option value={country}>{countryName(country)}</option>}
                {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </label>
            </div>
          </div>

          {error && !taskData ? (
            <LoadError what="calendar" onRetry={() => refetch()} />
          ) : (
            <>
              <h2 className="flex flex-wrap items-baseline gap-x-3 text-2xl font-extrabold text-plum-900" aria-live="polite">
                {title}
                {bsTitle && <span lang="ne" className="text-lg font-bold text-[#d14d45]">{bsTitle}</span>}
              </h2>

              <div role="grid" aria-label={title} className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-plum-800/10">
                <div role="row" className="grid grid-cols-7 bg-coral-400 text-center text-sm font-semibold text-plum-900">
                  {WEEKDAYS.map((w, i) => (
                    <div key={w} role="columnheader" className={`py-3 ${weekend.includes(i) ? "text-white" : ""}`}>{w}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {days.map((d, i) => {
                    const key = iso(d);
                    const items = byDay.get(key) ?? [];
                    const isHoliday = items.some((e) => e.kind === "holiday");
                    const inMonth = d.getMonth() === cursor.month;
                    const isToday = key === todayKey;
                    const isSel = key === selected;
                    return (
                      <button key={key} type="button" role="gridcell" aria-selected={isSel}
                        aria-label={`${longDay(key)}${items.length ? `, ${items.map((e) => e.label).join(", ")}` : ""}`}
                        onClick={() => pick(d)}
                        className={`flex min-h-20 flex-col items-stretch gap-1 border-plum-800/10 p-2 text-left transition hover:bg-sun-300/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-plum-800 sm:min-h-28 ${
                          i % 7 !== 6 ? "border-r" : ""} ${i < 35 ? "border-b" : ""} ${
                          isSel ? "bg-sun-300/50 ring-2 ring-inset ring-sun-400"
                            : !inMonth ? "bg-slate-50"
                              : isHoliday ? "bg-coral-400/15"
                                : weekend.includes(d.getDay()) ? "bg-blush/50" : ""}`}>
                        <span className="flex items-start justify-between gap-1">
                          <span className={`grid h-9 w-9 place-items-center rounded-full text-lg font-bold ${
                            isToday ? "bg-coral-400 text-plum-900"
                              : !inMonth ? "text-slate-300"
                                : isHoliday ? "text-[#d14d45]" : "text-plum-900"}`}>
                            {d.getDate()}
                          </span>
                          {bsDays.has(key) && (
                            <span lang="ne" className={`pt-1.5 text-sm font-semibold leading-none ${inMonth ? "text-plum-800/60" : "text-slate-300"}`}>{bsDays.get(key)}</span>
                          )}
                        </span>

                        {/* desktop: titles; phone: just coloured dots */}
                        <span className="hidden space-y-1 sm:block">
                          {items.slice(0, MAX_CHIPS).map((e) => (
                            <span key={e.key} style={{ "--c": e.color } as CSSProperties}
                              className={`block truncate rounded-md border-l-4 border-(--c) bg-[color-mix(in_srgb,var(--c)_12%,white)] px-1.5 py-0.5 text-xs font-medium text-slate-800 ${
                                e.done ? "line-through opacity-60" : ""}`}>
                              {e.label}
                            </span>
                          ))}
                          {items.length > MAX_CHIPS && (
                            <span className="block px-1 text-xs font-medium text-slate-500">+{items.length - MAX_CHIPS} more</span>
                          )}
                        </span>
                        <span className="flex flex-wrap gap-0.5 sm:hidden" aria-hidden="true">
                          {items.slice(0, 4).map((e) => (
                            <span key={e.key} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: e.color }} />
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <section aria-label={longDay(selected)} className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-bold">
                    {longDay(selected)}
                    {bsOn && bsLong(parse(selected)) && <span lang="ne" className="ml-3 text-base font-semibold text-slate-500">{bsLong(parse(selected))}</span>}
                  </h2>
                  {!adding && !editingEventId && (
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => setAdding("event")}>Add event</Button>
                      <Button variant="secondary" onClick={() => setAdding("task")}>Add task</Button>
                    </div>
                  )}
                </div>

                {adding === "task" && (
                  <Card role="region" aria-label="New task" className="max-w-2xl">
                    <TaskForm defaultDue={selected} onDone={() => setAdding(null)} />
                  </Card>
                )}
                {adding === "event" && (
                  <Card role="region" aria-label="New event" className="max-w-2xl">
                    <EventForm date={selected} onDone={() => setAdding(null)} />
                  </Card>
                )}

                {nothing && <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Nothing on this day.</p>}

                {(dayHolidays.length > 0 || dayMarkers.length > 0) && (
                  <ul className="space-y-2">
                    {[...dayHolidays, ...dayMarkers].map((e) => (
                      <li key={e.key} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                        <span aria-hidden="true" className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
                        <p className="min-w-0 flex-1 truncate font-semibold">{e.label}</p>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {e.kind === "holiday" ? "Holiday" : "Semester"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {dayEvents.length > 0 && (
                  <ul className="space-y-2">
                    {dayEvents.map((ev) =>
                      editingEventId === ev.id ? (
                        <li key={ev.id}><Card className="max-w-2xl"><EventForm event={ev} date={selected} onDone={() => setEditingEventId(null)} /></Card></li>
                      ) : (
                        <li key={ev.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                          <span aria-hidden="true" className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: KINDS[ev.kind].color }} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold">{ev.title}</p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {KINDS[ev.kind].label}{ev.endDate && ` · ${shortDay(ev.startDate)} to ${shortDay(ev.endDate)}`}
                            </p>
                            {ev.notes && <p className="mt-1 whitespace-pre-wrap wrap-break-word text-sm text-slate-600">{ev.notes}</p>}
                          </div>
                          <div className="flex shrink-0 gap-1 text-sm">
                            <button onClick={() => { setEditingEventId(ev.id); setAdding(null); }} className="rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100">Edit</button>
                            <button onClick={() => { if (confirm(`Delete "${ev.title}"?`)) removeEvent({ variables: { id: ev.id } }); }}
                              className="rounded-lg px-2 py-1 text-red-600 hover:bg-red-50">Delete</button>
                          </div>
                        </li>
                      ),
                    )}
                  </ul>
                )}

                {dayTasks.length > 0 && (
                  <ul className="space-y-2">
                    {dayTasks.map((t) => (
                      <li key={t.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                        <span aria-hidden="true" className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: t.course?.color ?? TASK_COLOR }} />
                        <div className="min-w-0 flex-1">
                          <p className={`truncate font-semibold ${t.status === "done" ? "text-slate-400 line-through" : ""}`}>{t.title}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                            {t.course ? <span className="font-semibold" style={{ color: t.course.color }}>{t.course.code}</span> : <span>Personal</span>}
                            <span className={isOverdue(t) ? "font-semibold text-red-600" : ""}>{dueLabel(t.dueDate)}</span>
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          t.status === "done" ? "bg-emerald-100 text-emerald-800" : isOverdue(t) ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>
                          {statusNote(t)}
                        </span>
                        <Link to="/tasks" className="shrink-0 text-xs font-medium text-plum-800 underline">Open</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      }
    />
  );
}