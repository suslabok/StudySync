import { useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation } from "@apollo/client/react";
import { CREATE_COURSE } from "../graphql/dashboard";
import { UPDATE_COURSE } from "../graphql/files";
import { Banner, Button, toFieldErrors, type ApiError } from "./AppShell";
import TextField from "./TextField";

const COLORS = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2"];

type CourseLite = { id: string; code: string; title: string; color: string };

/** Add a course, or edit one when `course` is given (works for courses in any semester). */
export default function CourseForm({ course, onDone }: { course?: CourseLite; onDone: () => void }) {
  const editing = !!course;
  const [form, setForm] = useState({
    code: course?.code ?? "", title: course?.title ?? "", color: course?.color ?? COLORS[0],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [run, { loading }] = useMutation<any>(editing ? UPDATE_COURSE : CREATE_COURSE, {
    refetchQueries: ["Dashboard", "Semesters"],
    awaitRefetchQueries: true,
  });
  const set = (key: "code" | "title") => (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });
  // a colour that isn't in the palette (older course) still shows as selected
  const palette = COLORS.includes(form.color) ? COLORS : [form.color, ...COLORS];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    try {
      const { data } = await run({ variables: editing ? { id: course!.id, ...form } : { ...form } });
      const errs: ApiError[] = data[editing ? "updateCourse" : "createCourse"].errors;
      if (errs.length) return setErrors(toFieldErrors(errs, ["code", "title", "color"]));
      onDone();
    } catch (err) {
      console.error(err);
      setErrors({ form: "Something went wrong. Please try again." });
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Code" placeholder="CS101" value={form.code}
          onChange={set("code")} error={errors.code} required />
        <div className="sm:col-span-2">
          <TextField label="Title" placeholder="Intro to Computer Science" value={form.title}
            onChange={set("title")} error={errors.title} required />
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Colour</span>
        <div className="flex flex-wrap gap-2">
          {palette.map((c) => (
            <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={form.color === c}
              onClick={() => setForm({ ...form, color: c })}
              style={{ backgroundColor: c }}
              className={`h-8 w-8 rounded-full ring-offset-2 transition ${
                form.color === c ? "ring-2 ring-slate-900" : "hover:ring-2 hover:ring-slate-300"}`} />
          ))}
        </div>
        {errors.color && <p className="mt-1.5 text-sm text-red-600">{errors.color}</p>}
      </div>

      {errors.form && <Banner>{errors.form}</Banner>}
      <div className="flex gap-3">
        <Button disabled={loading}>{loading ? "Saving…" : editing ? "Save changes" : "Add course"}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}