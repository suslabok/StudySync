import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@apollo/client/react";
import { SEARCH, hitLink, snippetParts, type SearchHit } from "../graphql/search";

const KIND: Record<SearchHit["kind"], string> = { task: "Task", post: "Post", comment: "Comment", assignment: "Assignment" };
const SHOWN = 8;

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function Snippet({ text }: { text: string }) {
  return (
    <span className="line-clamp-2 wrap-break-word text-xs text-slate-600">
      {snippetParts(text).map((p, i) => (i % 2 ? <mark key={i} className="rounded bg-sun-300 px-0.5 text-plum-900">{p}</mark> : <span key={i}>{p}</span>))}
    </span>
  );
}

/** Search box with live suggestions underneath. Type, then pick a result. No separate page. */
export default function SearchBox({ autoFocus = false, wide = false, variant = "light", onPick }: {
  autoFocus?: boolean; wide?: boolean; variant?: "light" | "dark" | "bar"; onPick?: () => void;
}) {
  const navigate = useNavigate();
  const listId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const q = useDebounced(text.trim(), 250);
  const ready = q.length >= 2;
  const { data, loading, error } = useQuery<{ search: SearchHit[] }>(SEARCH, {
    variables: { q }, skip: !ready, fetchPolicy: "network-only",
  });
  const hits = ready ? (data?.search ?? []).slice(0, SHOWN) : [];
  const waiting = text.trim() !== q || loading;     // typed something new, or the answer is on its way

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useEffect(() => setActive(-1), [q]);

  function pick(h: SearchHit) {
    setOpen(false);
    setText("");
    onPick?.();
    navigate(hitLink(h));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!hits.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % hits.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i <= 0 ? hits.length - 1 : i - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(hits[active]); }
  }

  const show = open && text.trim().length > 0;
  return (
    <div ref={ref} className="relative w-full lg:w-auto">
      <label className="sr-only" htmlFor={`${listId}-input`}>Search tasks and course streams</label>
      <input id={`${listId}-input`} type="search" autoFocus={autoFocus} value={text} placeholder={variant === "bar" ? "Search your tasks, assignments and course posts" : "Search"}
        role="combobox" aria-expanded={show} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
        className={`border text-sm focus:outline-none focus:ring-2 focus:ring-sun-400 ${
          variant === "bar"
            ? "w-full rounded-2xl border-slate-100 bg-white py-3.5 pl-5 pr-12 text-plum-900 shadow-sm placeholder:text-slate-400 focus:border-plum-800"
            : variant === "dark"
              ? "rounded-full border-white/15 bg-white/10 px-4 py-2 text-white placeholder:text-white/50 focus:bg-white/15"
              : "rounded-full border-slate-200 bg-slate-50 px-4 py-2 text-plum-900 focus:border-plum-800 focus:bg-white"} ${
          variant !== "bar" ? (wide ? "w-full" : "w-52") : ""}`} />
      {variant === "bar" && (
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-plum-800">
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
      )}

      {show && (
        <div id={listId} role="listbox" aria-label="Search results"
 className={`absolute left-0 z-30 mt-2 max-h-104 overflow-y-auto rounded-2xl border border-slate-200 bg-white text-plum-900 shadow-xl ${
            variant === "bar" ? "right-0" : "w-[min(26rem,calc(100vw-2rem))]"}`}>
          {!ready ? (
            <p className="px-4 py-3 text-sm text-slate-500">Keep typing…</p>
          ) : error && !data ? (
            <p role="alert" className="px-4 py-3 text-sm text-red-700">Search isn't working right now.</p>
          ) : waiting && hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500" aria-busy="true">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">Nothing matches “{q}”.</p>
          ) : (
            hits.map((h, i) => (
              <button key={`${h.kind}-${h.id}`} id={`${listId}-${i}`} role="option" aria-selected={i === active} type="button"
                onMouseEnter={() => setActive(i)} onClick={() => pick(h)}
                className={`block w-full border-b border-slate-100 px-4 py-3 text-left last:border-b-0 ${i === active ? "bg-slate-50" : ""}`}>
                <span className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="rounded-full bg-plum-800/10 px-2 py-0.5 font-semibold text-plum-800">{KIND[h.kind]}</span>
                  {h.course && <span className="rounded-full px-2 py-0.5 font-semibold text-white" style={{ backgroundColor: h.course.color }}>{h.course.code}</span>}
                </span>
                {h.title && <span className="mt-1 block wrap-break-word text-sm font-semibold">{h.title}</span>}
                <Snippet text={h.snippet} />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}