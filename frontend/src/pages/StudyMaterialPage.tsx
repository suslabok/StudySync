import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@apollo/client/react";
import { AppShell, Banner, Button, Card, LoadError, SemesterNav, SemesterSummary, fieldCls } from "../components/AppShell";
import { DASHBOARD, SEMESTERS, type DashboardData, type SemestersData } from "../graphql/dashboard";
import {
  DELETE_MATERIAL, GENERATE_STUDY, UPDATE_MATERIAL, RECORD_CARD, STUDY_ATTEMPTS, STUDY_CARDS, STUDY_MATERIAL, STUDY_MATERIALS, STUDY_QUESTIONS,
  SUBMIT_QUIZ, SUBMIT_SHORT, type Attempt, type Card as CardT, type Material, type Question, type QuizItem, type ShortItem,
} from "../graphql/study";

type Tab = "notes" | "quiz" | "cards" | "short" | "progress";
const TABS: { id: Tab; label: string }[] = [
  { id: "notes", label: "Notes" }, { id: "quiz", label: "Quiz" }, { id: "cards", label: "Flashcards" },
  { id: "short", label: "Short answer" }, { id: "progress", label: "Progress" },
];
const CHOICE = ["A", "B", "C", "D"];

/* ------------------------------ notes ------------------------------ */
function Notes({ m }: { m: Material }) {
  const n = m.notes!;
  return (
    <div className="space-y-5">
      {n.summary && (
        <Card className="border-t-4 border-t-sun-400">
          <h3 className="font-bold">Summary</h3>
          <p className="mt-2 leading-relaxed">{n.summary}</p>
        </Card>
      )}
      {n.points.length > 0 && (
        <Card className="border-t-4 border-t-coral-400"><h3 className="font-bold">Key points</h3>
          <ol className="mt-3 space-y-3 text-sm">{n.points.map((p, i) => (
            <li key={i} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-coral-400 text-xs font-bold text-plum-900">{i + 1}</span><span className="pt-0.5">{p}</span></li>))}</ol>
        </Card>)}
      {n.terms.length > 0 && (
        <section>
          <h3 className="mb-3 font-bold">Important terms</h3>
          <dl className="grid gap-3 sm:grid-cols-2">{n.terms.map((t, i) => (
            <div key={i} className={`rounded-2xl border-l-4 p-4 text-sm ${i % 2 ? "border-sun-400 bg-sun-300/30" : "border-coral-400 bg-blush/70"}`}><dt className="font-bold">{t.term}</dt><dd className="mt-1 text-plum-800">{t.meaning}</dd></div>))}</dl>
        </section>)}
    </div>
  );
}

/* ------------------------------ quiz ------------------------------ */
function Quiz({ id }: { id: string }) {
  const { data, loading, error, refetch } = useQuery<any>(STUDY_QUESTIONS, { variables: { materialId: id, kind: "mcq" }, fetchPolicy: "cache-and-network" });
  const [submit, { loading: sending }] = useMutation<any>(SUBMIT_QUIZ, { refetchQueries: [STUDY_ATTEMPTS, STUDY_MATERIAL, STUDY_MATERIALS] });
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ score: number; total: number; percent: number; results: QuizItem[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const qs: Question[] = data?.studyQuestions ?? [];
  if (error) return <LoadError what="the quiz" onRetry={() => refetch()} />;
  if (loading && !data) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!qs.length) return <Card><p className="text-sm text-slate-500">No quiz questions yet. Try generating again with more text.</p></Card>;
  const by = new Map(result?.results.map((r) => [r.questionId, r]));

  async function finish() {
    setErr(null);
    const answers = qs.map((q) => ({ questionId: q.id, choice: picked[q.id] ?? null }));
    const { data } = await submit({ variables: { materialId: id, answers } });
    const p = data.submitQuiz;
    if (p.errors.length) return setErr(p.errors[0].message);
    setResult(p.result);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="space-y-4">
      {result && (
        <div role="status" className="flex items-center gap-4 rounded-3xl bg-coral-400 p-5 text-plum-900 shadow-sm">
          <p className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-sun-300 text-2xl font-extrabold text-plum-900 shadow-sm">{result.percent}%</p>
          <div><p className="text-lg font-extrabold">{result.percent >= 80 ? "Great work!" : result.percent >= 50 ? "Getting there" : "Keep practising"}</p>
            <p className="text-sm font-medium">{result.score} of {result.total} correct</p></div>
        </div>
      )}
      {!result && (
        <div className="rounded-2xl bg-sun-300/40 p-4" role="status">
          <div className="flex justify-between text-sm font-semibold"><span>Quiz</span><span>{Object.keys(picked).length} of {qs.length} answered</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/70"><div className="h-full rounded-full bg-coral-400 transition-all" style={{ width: `${(Object.keys(picked).length / qs.length) * 100}%` }} /></div>
        </div>
      )}
      {qs.map((q, qi) => {
        const r = by.get(q.id);
        return (
          <Card key={q.id} className={`border-t-4 ${qi % 2 ? "border-t-sun-400" : "border-t-coral-400"}`}>
            <p className="flex gap-3 font-semibold"><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-plum-900 ${qi % 2 ? "bg-sun-300" : "bg-coral-400"}`}>{qi + 1}</span><span className="pt-0.5">{q.prompt}</span></p>
            <ul className="mt-4 space-y-2">
              {q.options!.map((o, oi) => {
                const chosen = (r ? r.choice : picked[q.id]) === oi;
                const right = r && r.correctIndex === oi;
                const cls = r
                  ? right ? "border-emerald-500 bg-emerald-50" : chosen ? "border-red-400 bg-red-50" : "border-slate-200 opacity-70"
                  : chosen ? "border-coral-400 bg-coral-400/15" : "border-slate-200 hover:border-sun-400 hover:bg-sun-300/20";
                return (
                  <li key={oi}>
                    <button type="button" disabled={!!result} aria-pressed={chosen} onClick={() => setPicked((p) => ({ ...p, [q.id]: oi }))}
                      className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition ${cls}`}>
                      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${chosen && !r ? "bg-coral-400 text-plum-900" : "bg-sun-300 text-plum-900"}`}>{CHOICE[oi]}</span>
                      <span className="pt-0.5">{o}</span>
                      {r && right && <span className="ml-auto pt-0.5 text-xs font-bold text-emerald-700">Correct</span>}
                      {r && chosen && !right && <span className="ml-auto pt-0.5 text-xs font-bold text-red-600">Your answer</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            {r?.explanation && <p className="mt-3 rounded-xl bg-blush/60 p-3 text-sm text-plum-800">{r.explanation}</p>}
            {r && r.choice === null && <p className="mt-2 text-xs text-slate-500">You skipped this one.</p>}
          </Card>
        );
      })}
      {err && <Banner>{err}</Banner>}
      {result
        ? <Button onClick={() => { setResult(null); setPicked({}); window.scrollTo({ top: 0 }); }}>Try again</Button>
        : <Button onClick={finish} disabled={sending}>{sending ? "Marking…" : `Finish quiz (${Object.keys(picked).length}/${qs.length} answered)`}</Button>}
    </div>
  );
}

/* ------------------------------ flashcards ------------------------------ */
function Cards({ id }: { id: string }) {
  const { data, loading, error, refetch } = useQuery<any>(STUDY_CARDS, { variables: { materialId: id }, fetchPolicy: "cache-and-network" });
  const [record] = useMutation<any>(RECORD_CARD);
  const [weakOnly, setWeakOnly] = useState(false);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [session, setSession] = useState({ knew: 0, missed: 0 });
  const all: CardT[] = data?.studyCards ?? [];
  const deck = weakOnly ? all.filter((c) => c.weak) : all;
  useEffect(() => { setI(0); setFlipped(false); }, [weakOnly, id]);
  if (error) return <LoadError what="the flashcards" onRetry={() => refetch()} />;
  if (loading && !data) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!all.length) return <Card><p className="text-sm text-slate-500">No flashcards yet.</p></Card>;

  const done = i >= deck.length;
  const card = deck[i];
  async function answer(knew: boolean) {
    setSession((s) => ({ knew: s.knew + (knew ? 1 : 0), missed: s.missed + (knew ? 0 : 1) }));
    setFlipped(false);
    setI((n) => n + 1);
    try { await record({ variables: { cardId: card.id, knew } }); } catch { /* progress on this card just isn't saved */ }
  }
  const weakCount = all.filter((c) => c.weak).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold">{done ? "Deck finished" : `Card ${i + 1} of ${deck.length}`}</span>
        <label className="flex items-center gap-2"><input type="checkbox" checked={weakOnly} disabled={!weakCount && !weakOnly} onChange={(e) => setWeakOnly(e.target.checked)} />
          Only cards I find hard ({weakCount})</label>
      </div>
      {deck.length > 0 && <div className="h-2 overflow-hidden rounded-full bg-sun-300/40"><div className="h-full rounded-full bg-coral-400 transition-all" style={{ width: `${(Math.min(i, deck.length) / deck.length) * 100}%` }} /></div>}
      {deck.length === 0 ? <Card><p className="text-sm text-slate-500">Nothing hard yet. Go through the full deck first.</p></Card>
        : done ? (
          <Card className="border-t-4 border-t-coral-400 text-center">
            <p className="text-lg font-bold">Nice work!</p>
            <p className="mt-1 text-sm text-slate-600">You knew {session.knew} and missed {session.missed} this round.</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={() => { setI(0); setSession({ knew: 0, missed: 0 }); refetch(); }}>Go again</Button>
            </div>
          </Card>
        ) : (
          <>
            <button type="button" onClick={() => setFlipped((f) => !f)} aria-label={flipped ? "Show the question" : "Show the answer"}
              className={`relative flex min-h-64 w-full items-center justify-center rounded-3xl p-8 text-center text-xl font-bold shadow-md transition ${flipped ? "bg-coral-400 text-plum-900" : "bg-sun-300 text-plum-900 hover:bg-sun-400"}`}>
              <span className={`absolute left-5 top-4 rounded-full px-3 py-0.5 text-xs font-bold uppercase tracking-wide ${flipped ? "bg-sun-300 text-plum-900" : "bg-coral-400 text-plum-900"}`}>{flipped ? "Answer" : "Question"}</span>
              <span aria-live="polite">{flipped ? card.back : card.front}</span>
            </button>
            <p className="text-center text-xs text-slate-400">{flipped ? "Did you know it?" : "Tap the card to see the answer"}</p>
            {flipped && (
              <div className="flex justify-center gap-3">
                <button onClick={() => answer(false)} className="rounded-xl border border-red-300 px-5 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50">Didn't know</button>
                <button onClick={() => answer(true)} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">Knew it</button>
              </div>
            )}
          </>
        )}
    </div>
  );
}

/* ------------------------------ short answer ------------------------------ */
const MARK = ["Not yet", "Partly right", "Right"];
const MARK_CLS = ["bg-red-100 text-red-700", "bg-amber-100 text-amber-800", "bg-emerald-100 text-emerald-800"];

function Short({ id }: { id: string }) {
  const { data, loading, error, refetch } = useQuery<any>(STUDY_QUESTIONS, { variables: { materialId: id, kind: "short" }, fetchPolicy: "cache-and-network" });
  const [submit, { loading: sending }] = useMutation<any>(SUBMIT_SHORT, { refetchQueries: [STUDY_ATTEMPTS, STUDY_MATERIAL, STUDY_MATERIALS] });
  const [text, setText] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ percent: number; gradedBy: string; results: ShortItem[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const qs: Question[] = data?.studyQuestions ?? [];
  if (error) return <LoadError what="the questions" onRetry={() => refetch()} />;
  if (loading && !data) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!qs.length) return <Card><p className="text-sm text-slate-500">No short-answer questions yet.</p></Card>;
  const by = new Map(result?.results.map((r) => [r.questionId, r]));

  async function finish() {
    setErr(null);
    const answers = qs.map((q) => ({ questionId: q.id, answer: text[q.id] ?? "" }));
    const { data } = await submit({ variables: { materialId: id, answers } });
    const p = data.submitShortAnswers;
    if (p.errors.length) return setErr(p.errors[0].message);
    setResult(p.result);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="space-y-4">
      {result && (
        <div role="status" className="flex items-center gap-4 rounded-3xl bg-coral-400 p-5 text-plum-900 shadow-sm">
          <p className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-plum-800 text-2xl font-extrabold text-sun-300">{result.percent}%</p>
          <p className="text-sm font-medium">{result.gradedBy === "ai" ? "Marked by AI" : "Marked by keyword matching, so rephrased answers may score lower than they deserve"}</p>
        </div>
      )}
      {qs.map((q, qi) => {
        const r = by.get(q.id);
        return (
          <Card key={q.id} className={`border-t-4 ${qi % 2 ? "border-t-coral-400" : "border-t-sun-400"}`}>
            <p className="flex gap-3 font-semibold"><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-plum-900 ${qi % 2 ? "bg-coral-400" : "bg-sun-300"}`}>{qi + 1}</span><span className="pt-0.5">{q.prompt}</span></p>
            <textarea value={text[q.id] ?? ""} disabled={!!result} maxLength={2000} rows={3} aria-label={`Answer to question ${qi + 1}`}
              onChange={(e) => setText((t) => ({ ...t, [q.id]: e.target.value }))} className={fieldCls} placeholder="Write your answer…" />
            {r && (
              <div className="mt-3 space-y-2 text-sm">
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${MARK_CLS[r.score]}`}>{MARK[r.score]}</span>
                <p>{r.feedback}</p>
                <p className="rounded-xl bg-blush/60 p-3 text-plum-800"><span className="font-bold">Model answer: </span>{r.reference}</p>
              </div>
            )}
          </Card>
        );
      })}
      {err && <Banner>{err}</Banner>}
      {result
        ? <Button onClick={() => { setResult(null); setText({}); window.scrollTo({ top: 0 }); }}>Try again</Button>
        : <Button onClick={finish} disabled={sending}>{sending ? "Marking…" : "Submit answers"}</Button>}
    </div>
  );
}

/* ------------------------------ progress ------------------------------ */
function Progress({ id }: { id: string }) {
  const { data, loading, error, refetch } = useQuery<any>(STUDY_ATTEMPTS, { variables: { materialId: id }, fetchPolicy: "cache-and-network" });
  const rows: Attempt[] = data?.studyAttempts ?? [];
  if (error) return <LoadError what="your history" onRetry={() => refetch()} />;
  if (loading && !data) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!rows.length) return <Card><p className="text-sm text-slate-500">No attempts yet. Take the quiz or answer some short questions and your scores will show here.</p></Card>;
  const shown = [...rows].reverse().slice(-12);
  return (
    <div className="space-y-4">
      <Card>
        <h3 className="font-bold">Your scores</h3>
        <div className="mt-4 flex h-36 items-end gap-2" role="img" aria-label={`Last ${shown.length} scores: ${shown.map((r) => r.percent + "%").join(", ")}`}>
          {shown.map((r) => (
            <div key={r.id} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[10px] font-semibold text-slate-500">{r.percent}%</span>
              <div className={`w-full rounded-t-md ${r.kind === "quiz" ? "bg-sun-400" : "bg-coral-400"}`} style={{ height: `${Math.max(r.percent, 3)}%` }} />
            </div>
          ))}
        </div>
        <p className="mt-3 flex gap-4 text-xs text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-sun-400" />Quiz</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-coral-400" />Short answer</span></p>
      </Card>
      <Card>
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2.5">
              <span>{r.kind === "quiz" ? "Quiz" : "Short answers"} <span className="text-slate-400">· {new Date(r.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></span>
              <span className="font-semibold">{r.percent}%</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------ page ------------------------------ */
export default function StudyMaterialPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, loading, error, refetch } = useQuery<any>(STUDY_MATERIAL, { variables: { id } });
  const [tab, setTab] = useState<Tab>("notes");
  const [notice, setNotice] = useState<string | null>((location.state as any)?.notice ?? null);
  const [noticeBad, setNoticeBad] = useState<boolean>(!!(location.state as any)?.bad);
  const [genError, setGenError] = useState<string | null>(null);
  const [generate, { loading: generating }] = useMutation<any>(GENERATE_STUDY, {
    refetchQueries: [STUDY_QUESTIONS, STUDY_CARDS, STUDY_MATERIALS],
  });
  const [remove] = useMutation<any>(DELETE_MATERIAL, { refetchQueries: [STUDY_MATERIALS] });
  const [updateMat] = useMutation<any>(UPDATE_MATERIAL, { refetchQueries: [STUDY_MATERIALS] });
  const m: Material | null = data?.studyMaterial ?? null;
  const { data: dash } = useQuery<DashboardData>(DASHBOARD, { fetchPolicy: "cache-and-network" });
  const { data: semData } = useQuery<SemestersData>(SEMESTERS, { fetchPolicy: "cache-and-network" });
  const sem = dash?.dashboard.currentSemester ?? null;
  const semesterNav = sem && (
    <SemesterNav semesters={semData?.semesters ?? []} current={sem}
      onSelect={(sid) => navigate("/", { state: sid === sem.id ? null : { viewSemesterId: sid } })}
      onNew={() => navigate("/", { state: { newSemester: true } })} />
  );

  async function regenerate() {
    setGenError(null); setNotice(null); setNoticeBad(false);
    try {
      const { data } = await generate({ variables: { materialId: id } });
      const p = data.generateStudy;
      if (p.errors.length) return setGenError(p.errors[0].message);
      setNotice(p.message);
    } catch (err) {
      console.error(err);
      setGenError("Couldn't reach the server. Check your connection and try again.");
    }
  }
  async function del() {
    if (!window.confirm("Delete this material and its questions, cards and scores?")) return;
    const { data } = await remove({ variables: { id } });
    if (data.deleteStudyMaterial.ok) navigate("/study");
  }

  const main = (
    <div className="space-y-5">
      <Link to="/study" className="text-sm font-medium text-plum-800 hover:underline">← All material</Link>
      {error ? <LoadError what="this material" onRetry={() => refetch()} />
        : loading && !data ? <p className="text-sm text-slate-500">Loading…</p>
        : !m ? <Card><p className="font-semibold">Material not found</p><p className="mt-1 text-sm text-slate-500">It may have been deleted.</p></Card>
        : (
          <>
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="wrap-break-word text-2xl font-extrabold tracking-tight sm:text-3xl">{m.title}</h1>
                <p className="mt-1 text-sm text-slate-500">
                  {m.sourceKind === "file" ? m.fileName : "Pasted text"} · {m.charCount.toLocaleString()} characters
                  {m.generatedBy && <> · made by {m.generatedBy === "ai" ? "AI" : "basic mode"}</>}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <label htmlFor="mat-course" className="text-sm font-medium text-slate-700">Course</label>
                  <select id="mat-course" className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm" value={m.course?.id ?? ""}
                    onChange={async (e) => { await updateMat({ variables: { id: m.id, title: m.title, courseId: e.target.value || null } }); }}>
                    <option value="">No course</option>
                    {(dash?.dashboard.courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                {m.course && <Link to={`/focus?course=${m.course.id}`} className="rounded-xl bg-plum-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-plum-900">Start focus</Link>}
                <Button variant="secondary" onClick={regenerate} disabled={generating}>{generating ? "Working…" : m.generatedAt ? "Regenerate" : "Generate"}</Button>
                <Button variant="secondary" onClick={del} className="text-red-600">Delete</Button>
              </div>
            </header>
            {m.generatedAt && (
              <dl className="grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
                {([["Questions", m.questionCount], ["Short answer", m.shortCount], ["Flashcards", m.cardCount], ["Attempts", m.attempts],
                   ["Best score", m.bestPercent !== null ? `${m.bestPercent}%` : "none yet"]] as const).map(([k, v], i) => (
                  <div key={k} className={`rounded-2xl p-3 ${["bg-blush", "bg-sun-300/40", "bg-blush", "bg-sun-300/40", "bg-blush"][i]}`}>
                    <dd className="text-xl font-extrabold">{v}</dd><dt className="text-xs font-medium text-plum-800">{k}</dt>
                  </div>
                ))}
              </dl>
            )}
            {notice && <Banner kind={noticeBad ? "error" : "ok"}>{notice}</Banner>}
            {genError && <Banner>{genError}</Banner>}
            {!m.generatedAt ? (
              <Card className="border-t-4 border-t-sun-400 text-center">
                <p className="font-semibold">Ready to study</p>
                <p className="mt-1 text-sm text-slate-500">Generate notes, quiz questions and flashcards from this material.</p>
                <Button className="mt-4" onClick={regenerate} disabled={generating}>{generating ? "Working…" : "Generate notes & questions"}</Button>
              </Card>
            ) : (
              <>
                <div role="tablist" aria-label="Study modes" className="flex flex-wrap gap-2">
                  {TABS.map((t) => (
                    <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                      className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                        tab === t.id ? "bg-coral-400 text-plum-900 shadow-sm" : "bg-sun-300/40 text-plum-900 hover:bg-sun-300/70"}`}>{t.label}</button>
                  ))}
                </div>
                <div role="tabpanel">
                  {tab === "notes" && m.notes && <Notes m={m} />}
                  {tab === "quiz" && <Quiz id={id} />}
                  {tab === "cards" && <Cards id={id} />}
                  {tab === "short" && <Short id={id} />}
                  {tab === "progress" && <Progress id={id} />}
                </div>
              </>
            )}
          </>
        )}
    </div>
  );

  return <AppShell main={main} semesterNav={semesterNav} side={dash ? <SemesterSummary shown={sem} courses={dash.dashboard.courses} /> : null} />;
}