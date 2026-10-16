import { useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation } from "@apollo/client/react";
import { CREATE_SEMESTER } from "../graphql/dashboard";
import TextField from "./TextField";

type Errors = { form?: string; name?: string; startDate?: string; endDate?: string };
const FIELD_KEYS = ["name", "startDate", "endDate"];

export default function SemesterForm() {
  const [form, setForm] = useState({ name: "", startDate: "", endDate: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [run, { loading }] = useMutation<any>(CREATE_SEMESTER, {
    refetchQueries: ["Dashboard"],
    awaitRefetchQueries: true,
  });
  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    try {
      const { data } = await run({ variables: form });
      const errs: { field: string | null; message: string }[] = data.createSemester.errors;
      if (errs.length) {
        const next: Errors = {};
        for (const err of errs) {
          const key = (FIELD_KEYS.includes(err.field ?? "") ? err.field : "form") as keyof Errors;
          next[key] ??= err.message;
        }
        setErrors(next);
      }
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
      {errors.form && (
        <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{errors.form}</p>
      )}
      <button disabled={loading}
        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60">
        {loading ? "Saving…" : "Create semester"}
      </button>
    </form>
  );
}
