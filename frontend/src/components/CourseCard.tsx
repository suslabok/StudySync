import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@apollo/client/react";
import { DELETE_COURSE, type Course } from "../graphql/dashboard";
import { DUE_SOON, TASKS } from "../graphql/tasks";
import { Card } from "./AppShell";
import CourseForm from "./CourseForm";

/** The whole card opens the course. Edit and Delete work for courses in any semester, past ones included. */
export default function CourseCard({ course }: { course: Course }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [remove, { loading }] = useMutation(DELETE_COURSE, {
    variables: { id: course.id },
    // deleting a course unlinks its tasks, so refresh those lists as well
    refetchQueries: ["Dashboard", "Semesters", TASKS, DUE_SOON],
  });

  if (editing) {
    return (
      <li className="sm:col-span-2">
        <Card><CourseForm course={course} onDone={() => setEditing(false)} /></Card>
      </li>
    );
  }

  async function onDelete() {
    if (!window.confirm(`Delete ${course.code}? This cannot be undone.`)) return;
    setError("");
    try {
      await remove();
    } catch (e) {
      console.error(e);
      setError("Could not delete the course. Please try again.");
    }
  }

  const actionCls = "pointer-events-auto relative z-10 text-sm text-slate-500 transition-colors disabled:opacity-50 group-hover:text-white/80 group-hover:hover:text-white";
  return (
    <li
      style={{ "--c": course.color } as CSSProperties}
      className="group relative flex min-h-28 overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--c)_30%,white)] bg-[color-mix(in_srgb,var(--c)_10%,white)] shadow-sm transition-colors hover:border-transparent hover:bg-(--c) focus-within:border-transparent focus-within:bg-(--c)"
    >
      {/* stretched link: makes the entire card clickable */}
      <Link to={`/courses/${course.id}`} aria-label={`Open ${course.code} ${course.title}`}
        className="absolute inset-0 rounded-xl focus:outline-none" />

      <span className="w-10 shrink-0 bg-(--c)" aria-hidden="true" />
      <div className="pointer-events-none relative flex min-w-0 flex-1 items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <span className="inline-block rounded-full bg-(--c) px-3 py-0.5 text-sm font-semibold uppercase tracking-wide text-white transition-colors group-hover:bg-white/25 group-focus-within:bg-white/25">
            {course.code}
          </span>
          <h3 className="mt-2 truncate text-xl font-bold text-slate-900 transition-colors group-hover:text-white group-focus-within:text-white">
            {course.title}
          </h3>
          {error && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{error}</p>}
        </div>
        <div className="flex shrink-0 gap-3 self-start">
          <button type="button" aria-label={`Edit ${course.code}`} onClick={() => setEditing(true)}
            className={`${actionCls} hover:text-plum-800`}>Edit</button>
          <button type="button" disabled={loading} aria-label={`Delete ${course.code}`} onClick={onDelete}
            className={`${actionCls} hover:text-red-600`}>Delete</button>
        </div>
      </div>
    </li>
  );
}