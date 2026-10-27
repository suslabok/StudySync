import { useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation } from "@apollo/client/react";
import { CREATE_SEMESTER, UPDATE_SEMESTER, type Semester } from "../graphql/dashboard";
import { Banner, Button, toFieldErrors, type ApiError } from "./AppShell";
import TextField from "./TextField";

export default function SemesterForm({ semester, onDone }: { semester?: Semester; onDone?: () => void }) {
  const editing = !!semester;
  const [form, setForm] = useState({
    name: semester?.name ?? "", startDate: semester?.startDate ?? "", endDate: semester?.endDate ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [run, { loading }] = useMutation<any>(editing ? UPDATE_SEMESTER : CREATE_SEMESTER, {
    refetchQueries: ["Dashboard", "Semesters"],
    awaitRefetchQueries: true,
  });
  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    try {
      const { data } = await run({ variables: semester ? { id: semester.id, ...form } : form });
      const errs: ApiError[] = data[editing ? "updateSemester" : "createSemester"].errors;
      if (errs.length) return setErrors(toFieldErrors(errs, ["name", "startDate", "endDate"]));
      onDone?.();
    } catch (err) {
      console.error(err);
      setErrors({ form: "Something went wrong. Please try again." });
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <TextField label="Semester name" placeholder="e.g. Fall 2026" value={form.name}
        onChange={set("name")} error={errors.name} required />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Start date" type="date" value={form.startDate}
          onChange={set("startDate")} error={errors.startDate} required />
        <TextField label="End date" type="date" value={form.endDate}
          onChange={set("endDate")} error={errors.endDate} required />
      </div>
      {errors.form && <Banner>{errors.form}</Banner>}
      <div className="flex gap-3">
        <Button className="flex-1" disabled={loading}>
          {loading ? "Saving…" : editing ? "Save changes" : "Create semester"}
        </Button>
        {editing && <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>}
      </div>
    </form>
  );
}