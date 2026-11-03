import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@apollo/client/react";
import { AppShell, Banner, Button, Card, LoadError, SemesterNav, SemesterSummary, fieldCls, toFieldErrors } from "../components/AppShell";
import TextField from "../components/TextField";
import { DASHBOARD, SEMESTERS, type DashboardData, type SemestersData } from "../graphql/dashboard";
import { toBase64 } from "../graphql/taskFiles";
import {
  ACCEPT, CREATE_MATERIAL, GENERATE_STUDY, STUDY_CONFIG, STUDY_MATERIALS, type Material,
} from "../graphql/study";

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function AddMaterial() {
  const navigate = useNavigate();
  const { data: cfg } = useQuery<any>(STUDY_CONFIG);
  const maxMb: number = cfg?.studyConfig.maxMb ?? 5;
  const [mode, setMode] = useState<"text" | "file">("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [create] = useMutation<any>(CREATE_MATERIAL, { refetchQueries: [STUDY_MATERIALS] });
  const [generate] = useMutation<any>(GENERATE_STUDY);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    if (mode === "file" && !file) return setErrors({ file: "Choose a file first." });
    if (mode === "file" && file!.size > maxMb * 1024 * 1024) return setErrors({ file: `Files can be up to ${maxMb} MB.` });
    try {
      setBusy(mode === "file" ? "Reading your file…" : "Saving…");
      const input = mode === "text"
        ? { title, text }
        : { title, fileName: file!.name, fileContent: await toBase64(file!) };
      const { data } = await create({ variables: { input } });
      const p = data.createStudyMaterial;
      if (p.errors.length) { setErrors(toFieldErrors(p.errors, ["title", "text", "file"])); return; }
      setBusy("Making notes and questions…");
      const id = p.material.id;
      // The material is saved by now. Whatever happens next, open it, so a retry doesn't create a duplicate.
      try {
        const g = await generate({ variables: { materialId: id } });
        const gp = g.data.generateStudy;
        if (gp.errors.length) navigate(`/study/${id}`, { state: { notice: `Saved, but ${gp.errors[0].message.charAt(0).toLowerCase()}${gp.errors[0].message.slice(1)} Press Generate to try again.`, bad: true } });
        else navigate(`/study/${id}`, { state: { notice: gp.message } });
      } catch (err) {
        console.error(err);
        navigate(`/study/${id}`, { state: { notice: "Saved, but making the notes didn't work this time. Press Generate to try again.", bad: true } });
      }
    } catch (err) {
      console.error(err);
      setErrors({ form: "Couldn't save your material. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="max-w-2xl border-t-4 border-t-coral-400">
      <h2 className="text-lg font-bold">Add study material</h2>
      <p className="mt-1 text-sm text-slate-500">Paste your notes or upload a file. We'll turn it into notes, a quiz and flashcards.</p>
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        <TextField label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150}
          placeholder="e.g. Photosynthesis, chapter 4" error={errors.title} />

        <div role="tablist" aria-label="Material source" className="flex gap-2">
          {(["text", "file"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErrors({}); }}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                mode === m ? "bg-coral-400 text-plum-900 shadow-sm" : "bg-sun-300/40 text-plum-900 hover:bg-sun-300/70"}`}>
              {m === "text" ? "Paste text" : "Upload file"}
            </button>
          ))}
        </div>

        {mode === "text" ? (
          <div>
            <label htmlFor="study-text" className="mb-1.5 block text-sm font-medium text-slate-700">Your notes</label>
            <textarea id="study-text" rows={7} value={text} onChange={(e) => setText(e.target.value)} className={fieldCls}
              placeholder="Paste text from your notes, slides or textbook…" aria-invalid={!!errors.text} />
            {errors.text && <p role="alert" className="mt-1.5 text-sm text-red-600">{errors.text}</p>}
          </div>
        ) : (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700">File</span>
            <div className="flex flex-wrap items-center gap-3">
              <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" tabIndex={-1}
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErrors({}); }} />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>{file ? "Choose another" : "Choose a file"}</Button>
              <span className="min-w-0 break-all text-sm text-slate-600">{file ? file.name : `PDF, Word, PowerPoint, text or image, up to ${maxMb} MB`}</span>
            </div>
            {errors.file && <p role="alert" className="mt-1.5 text-sm text-red-600">{errors.file}</p>}
            {cfg && !cfg.studyConfig.aiEnabled && (
              <p className="mt-2 text-xs text-slate-500">Images and scanned PDFs need the AI key to be set up. Text-based files work without it.</p>
            )}
          </div>
        )}

        {errors.form && <Banner>{errors.form}</Banner>}
        <Button disabled={!!busy}>{busy ?? "Create notes & questions"}</Button>
      </form>
    </Card>
  );
}

const TILE = ["bg-coral-400 text-plum-900", "bg-sun-300 text-plum-900", "bg-blush text-plum-800"];
const kindLabel = (m: Material) =>
  m.sourceKind === "text" ? "TXT" : (m.fileName?.split(".").pop() ?? "FILE").slice(0, 4).toUpperCase();

function MaterialRow({ m, i }: { m: Material; i: number }) {
  return (
    <li>
      <Link to={`/study/${m.id}`}
        className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
        <span aria-hidden="true" className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-xs font-extrabold ${TILE[i % TILE.length]}`}>{kindLabel(m)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{m.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {m.sourceKind === "file" ? m.fileName : "Pasted text"} · added {when(m.createdAt)}
            {m.generatedAt ? ` · ${m.questionCount} questions · ${m.cardCount} cards` : " · not generated yet"}
          </p>
        </div>
        {m.bestPercent !== null
          ? <span className="shrink-0 rounded-full bg-sun-300 px-2.5 py-0.5 text-xs font-bold text-plum-900">Best {m.bestPercent}%</span>
          : <span className="shrink-0 rounded-full bg-blush px-2.5 py-0.5 text-xs font-semibold text-plum-800">No attempts</span>}
      </Link>
    </li>
  );
}

export default function StudyPage() {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useQuery<any>(STUDY_MATERIALS);
  const { data: cfg } = useQuery<any>(STUDY_CONFIG);
  const items: Material[] = data?.studyMaterials ?? [];
  const { data: dash } = useQuery<DashboardData>(DASHBOARD, { fetchPolicy: "cache-and-network" });
  const { data: semData } = useQuery<SemestersData>(SEMESTERS, { fetchPolicy: "cache-and-network" });
  const sem = dash?.dashboard.currentSemester ?? null;
  const semesterNav = sem && (
    <SemesterNav semesters={semData?.semesters ?? []} current={sem}
      onSelect={(sid) => navigate("/", { state: sid === sem.id ? null : { viewSemesterId: sid } })}
      onNew={() => navigate("/", { state: { newSemester: true } })} />
  );

  const main = (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Study</h1>
        <p className="mt-1 text-sm text-slate-500">Upload your material, get notes, then test yourself.</p>
        {cfg && (
          <p className="mt-3 max-w-2xl rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-600">
            {cfg.studyConfig.aiEnabled
              ? "AI is on: questions and marking come from Gemini."
              : "AI is off on this server, so questions are made in basic mode (simpler fill-in-the-blank style)."}
          </p>
        )}
      </header>
      <AddMaterial />
      <section aria-labelledby="mine">
        <h2 id="mine" className="mb-3 text-lg font-bold">Your material</h2>
        {error ? <LoadError what="your material" onRetry={() => refetch()} />
          : loading && !data ? <p className="text-sm text-slate-500">Loading…</p>
          : items.length === 0 ? <p className="rounded-2xl bg-sun-300/30 p-6 text-center text-sm text-plum-800">Nothing here yet. Add some notes above to get started.</p>
          : <ul className="space-y-3">{items.map((m, i) => <MaterialRow key={m.id} m={m} i={i} />)}</ul>}
      </section>
    </div>
  );

  return <AppShell main={main} semesterNav={semesterNav} side={dash ? <SemesterSummary shown={sem} courses={dash.dashboard.courses} /> : null} />;
}