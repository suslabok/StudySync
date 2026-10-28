import { Link } from "react-router-dom";
import { useMutation } from "@apollo/client/react";
import { DELETE_COURSE, type Course } from "../graphql/dashboard";

export default function CourseCard({ course, readOnly = false }: { course: Course; readOnly?: boolean }) {
  const [remove, { loading }] = useMutation(DELETE_COURSE, {
    variables: { id: course.id },
    refetchQueries: ["Dashboard"],
  });

  return (
    <li className="flex overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <span className="w-2 shrink-0" style={{ backgroundColor: course.color }} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{course.code}</p>
          <h3 className="truncate font-medium text-slate-900">
            <Link to={`/courses/${course.id}`} className="hover:underline">{course.title}</Link>
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-sm">
        <Link to={`/courses/${course.id}`} className="font-medium text-plum-800 hover:underline">
          Open{!readOnly && " / share"}
        </Link>
        {!readOnly && (
        <button
          disabled={loading}
          aria-label={`Delete ${course.code}`}
          onClick={() => {
            if (window.confirm(`Delete ${course.code}? This cannot be undone.`)) remove().catch(console.error);
          }}
          className="text-slate-400 hover:text-red-600 disabled:opacity-50"
        >
          Delete
        </button>
        )}
        </div>
      </div>
    </li>
  );
}