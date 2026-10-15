import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";

function initials(name: string) {
  return (
    name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?"
  );
}

export default function DashboardPage() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // close the menu on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
        <span className="text-lg font-semibold tracking-tight text-blue-700">StudySync</span>

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Account menu"
            className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
          >
            <span className="grid h-10 w-10 place-items-center rounded-full bg-blue-600 text-sm font-semibold text-white">
              {initials(user?.displayName ?? "")}
            </span>
          </button>

          {open && (
            <div
              role="menu"
              className="absolute right-0 z-10 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
            >
              <div className="px-3 py-2">
                <p className="truncate text-sm font-medium">{user?.displayName}</p>
                <p className="truncate text-xs text-slate-500">{user?.email}</p>
              </div>
              <button
                role="menuitem"
                onClick={signOut}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Dashboard content goes here as features are built */}
      <main className="mx-auto max-w-5xl px-4 py-8" />
    </div>
  );
}