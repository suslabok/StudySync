import { useState } from "react";
import { useMutation, useQuery } from "@apollo/client/react";
import { Banner, Button, Card } from "./AppShell";
import TextField from "./TextField";
import { COURSE_MEETING, SET_COURSE_MEETING, type CourseMeetingData } from "../graphql/meetings";

/** Google Meet link for a course: everyone can join, whoever may edit can paste a new link. */
export default function CourseMeeting({ courseId }: { courseId: string }) {
  const { data, error } = useQuery<CourseMeetingData>(COURSE_MEETING, { variables: { courseId } });
  const [save, { loading }] = useMutation<any>(SET_COURSE_MEETING, {
    refetchQueries: [{ query: COURSE_MEETING, variables: { courseId } }],
  });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [err, setErr] = useState("");

  if (error || !data) return null;
  const { url, canEdit } = data.courseMeeting;
  if (!url && !canEdit) return null;

  async function submit(next: string) {
    setErr("");
    try {
      const { data: d } = await save({ variables: { courseId, url: next } });
      const e = d.setCourseMeeting.errors;
      if (e.length) return setErr(e[0].message);
      setEditing(false); setValue("");
    } catch (x) {
      console.error(x);
      setErr("Couldn't save the link. Check your connection and try again.");
    }
  }

  return (
    <Card role="region" aria-label="Google Meet" className="border-t-4 border-t-sun-400">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-lg font-bold">Google Meet</h2>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="rounded-xl bg-plum-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-plum-900">
            Join meeting
          </a>
        )}
        {canEdit && !editing && (
          <>
            <Button variant="secondary" onClick={() => { setEditing(true); setValue(""); setErr(""); }}>{url ? "Change link" : "Add meeting link"}</Button>
            {url && <Button variant="secondary" className="text-red-600" disabled={loading} onClick={() => submit("")}>Remove</Button>}
          </>
        )}
      </div>
      {url && !editing && <p className="mt-2 break-all text-sm text-slate-500">{url.replace("https://", "")}</p>}
      {canEdit && editing && (
        <form noValidate className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); submit(value); }}>
          <TextField label="Meet link or code" value={value} onChange={(e) => setValue(e.target.value)}
            placeholder="meet.google.com/abc-defg-hij" error={err} autoFocus />
          <p className="text-sm text-slate-500">
            No link yet? <a href="https://meet.new" target="_blank" rel="noopener noreferrer" className="font-medium text-plum-800 underline">Start a new meeting</a>, then paste its link here.
          </p>
          <div className="flex gap-2">
            <Button disabled={loading}>{loading ? "Saving…" : "Save"}</Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      )}
      {!editing && err && <Banner>{err}</Banner>}
    </Card>
  );
}