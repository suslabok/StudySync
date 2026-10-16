import { useMutation } from "@apollo/client/react";
import { DELETE_COURSE, type Course } from "../graphql/dashboard";

export default function CourseCard({ course }: { course: Course }) {
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
          <h3 className="truncate font-medium text-slate-900">{course.title}</h3>
          {course.instructor && <p className="mt-1 text-sm text-slate-500">{course.instructor}</p>}
        </div>
        <button
          disabled={loading}
          aria-label={`Delete ${course.code}`}
          onClick={() => {
            if (window.confirm(`Delete ${course.code}? This cannot be undone.`)) remove().catch(console.error);
          }}
          className="text-sm text-slate-400 hover:text-red-600 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </li>
  );
}