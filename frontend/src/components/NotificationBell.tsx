import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@apollo/client/react";
import {
  MARK_ALL_READ, MARK_READ, NOTIFICATIONS, ago, type AppNotification, type NotificationsData,
} from "../graphql/notifications";

const KIND_DOT: Record<AppNotification["kind"], string> = {
  assignment: "bg-coral-400", post: "bg-plum-800", comment: "bg-sun-400", joined: "bg-emerald-500",
};

/** Bell with a count of unread notifications plus work that is due soon or late. Refreshes every minute. */
export default function NotificationBell({ onDark = false }: { onDark?: boolean }) {
  const navigate = useNavigate();
  const { data } = useQuery<NotificationsData>(NOTIFICATIONS, { pollInterval: 60_000, fetchPolicy: "cache-and-network" });
  const [markRead] = useMutation<any>(MARK_READ, { refetchQueries: [NOTIFICATIONS] });
  const [markAll] = useMutation<any>(MARK_ALL_READ, { refetchQueries: [NOTIFICATIONS] });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const feed = data?.notifications;
  const items = feed?.items ?? [];
  const reminders = feed?.reminders ?? [];
  const count = (feed?.unread ?? 0) + reminders.length;

  function openItem(n: AppNotification) {
    if (!n.read) markRead({ variables: { id: n.id } });
    setOpen(false);
    if (n.courseId) navigate(`/courses/${n.courseId}`);
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={count ? `Notifications, ${count} new` : "Notifications"}
        className={`relative grid h-11 w-11 place-items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sun-400 ${
          onDark ? "text-white hover:bg-white/10" : "text-plum-800 hover:bg-slate-100"}`}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {count > 0 && (
          <span aria-hidden="true"
            className="absolute right-0.5 top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-coral-400 px-1 text-[11px] font-bold text-plum-900 ring-2 ring-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications"
          className="absolute right-0 z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white text-plum-900 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-base font-extrabold">Notifications</h2>
            {(feed?.unread ?? 0) > 0 && (
              <button type="button" onClick={() => markAll()} className="text-xs font-semibold text-plum-800 underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-104 overflow-y-auto">
            {reminders.length > 0 && (
              <section aria-label="Due soon">
                <h3 className="bg-sun-300/40 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-plum-800">Due soon</h3>
                <ul>
                  {reminders.map((r) => (
                    <li key={r.taskId}>
                      <button type="button" onClick={() => { setOpen(false); navigate("/tasks"); }}
                        className="flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50">
                        <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${r.overdue ? "bg-red-500" : "bg-sun-400"}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block wrap-break-word text-sm font-semibold">{r.title}</span>
                          <span className={`block text-xs ${r.overdue ? "font-semibold text-red-600" : "text-slate-500"}`}>
                            {r.courseCode ? `${r.courseCode} · ` : ""}{dueText(r.dueDate, r.overdue)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {items.length > 0 && (
              <section aria-label="Activity">
                {reminders.length > 0 && <h3 className="bg-slate-50 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">Activity</h3>}
                <ul>
                  {items.map((n) => (
                    <li key={n.id}>
                      <button type="button" onClick={() => openItem(n)}
                        className={`flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${n.read ? "" : "bg-blush/40"}`}>
                        <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${n.read ? "bg-slate-300" : KIND_DOT[n.kind]}`} />
                        <span className="min-w-0 flex-1">
                          <span className={`block wrap-break-word text-sm ${n.read ? "font-medium text-slate-600" : "font-semibold"}`}>{n.title}</span>
                          {n.body && <span className="line-clamp-2 wrap-break-word text-xs text-slate-500">{n.body}</span>}
                          <span className="mt-0.5 block text-xs text-slate-400">{ago(n.createdAt)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {items.length === 0 && reminders.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-slate-500">You're all caught up.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function dueText(iso: string, overdue: boolean) {
  const [y, m, d] = iso.split("-").map(Number);
  const days = Math.round((new Date(y, m - 1, d).getTime() - new Date(new Date().setHours(0, 0, 0, 0)).getTime()) / 86_400_000);
  if (overdue) return days === -1 ? "Overdue by 1 day" : `Overdue by ${-days} days`;
  return days === 0 ? "Due today" : days === 1 ? "Due tomorrow" : `Due in ${days} days`;
}