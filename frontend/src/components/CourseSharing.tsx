import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@apollo/client/react";
import { Button, fieldCls } from "./AppShell";
import Avatar from "./Avatar";
import TextField from "./TextField";
import { AttachButton, FileList } from "./TaskWidgets";
import { FILE_HINT, checkPicked, fmtSize, toBase64 } from "../graphql/taskFiles";
import {
  CREATE_COMMENT, CREATE_POST, DELETE_COMMENT, DELETE_POST, JOIN_COURSE, POSTS,
  type StreamPost,
} from "../graphql/sharing";
import { DASHBOARD, SEMESTERS } from "../graphql/dashboard";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function Composer({ id, placeholder, compact, allowFiles, onSubmit }: {
  id: string; placeholder: string; compact?: boolean; allowFiles?: boolean;
  onSubmit: (body: string, files: File[]) => Promise<string | null>; // an error message, or null on success
}) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function pick(list: File[]) {
    const problem = checkPicked(list, files.length);
    setError(problem ?? "");
    if (!problem) setFiles((f) => [...f, ...list]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const err = await onSubmit(body, files);
    setBusy(false);
    setError(err ?? "");
    if (!err) { setBody(""); setFiles([]); }
  }
  return (
    <form onSubmit={submit} className="space-y-2" noValidate>
      <label className="sr-only" htmlFor={id}>{placeholder}</label>
      <textarea id={id} rows={compact ? 1 : 3} className={fieldCls} value={body} placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)} />
      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-1.5 text-sm">
              <span aria-hidden="true">📎</span>
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 text-xs text-slate-400">{fmtSize(f.size)}</span>
              <button type="button" onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
                className="shrink-0 text-xs font-medium text-red-600 underline">Remove</button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant={compact ? "secondary" : "primary"} disabled={busy || (!body.trim() && files.length === 0)} className={compact ? "py-1" : ""}>
          {busy ? "Posting…" : compact ? "Reply" : "Post"}
        </Button>
        {allowFiles && <AttachButton onPick={pick} disabled={busy} />}
        {allowFiles && <span className="text-xs text-slate-400">{FILE_HINT}</span>}
      </div>
    </form>
  );
}

function PostCard({ post }: { post: StreamPost }) {
  const opts = { refetchQueries: [POSTS] };
  const [removePost] = useMutation<any>(DELETE_POST, opts);
  const [addComment] = useMutation<any>(CREATE_COMMENT, opts);
  const [removeComment] = useMutation<any>(DELETE_COMMENT, opts);

  return (
    <li className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <Avatar name={post.author.displayName} url={post.author.avatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{post.author.displayName}</p>
          <p className="text-xs text-slate-500">{when(post.createdAt)}</p>
        </div>
        {post.canDelete && (
          <button onClick={() => { if (confirm("Delete this post and its comments?")) removePost({ variables: { id: post.id } }); }}
            className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50">Delete</button>
        )}
      </div>
      {post.body && <p className="mt-3 whitespace-pre-wrap wrap-break-word text-sm">{post.body}</p>}
      {post.files.length > 0 && <div className="mt-3"><FileList files={post.files} /></div>}

      <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
        {post.comments.map((c) => (
          <div key={c.id} className="flex items-start gap-2">
            <Avatar name={c.author.displayName} url={c.author.avatarUrl} size={28} />
            <div className="min-w-0 flex-1 rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-xs"><span className="font-semibold">{c.author.displayName}</span> <span className="text-slate-500">{when(c.createdAt)}</span></p>
              <p className="whitespace-pre-wrap wrap-break-word text-sm">{c.body}</p>
            </div>
            {c.canDelete && (
              <button onClick={() => removeComment({ variables: { id: c.id } })} aria-label="Delete comment"
                className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600">✕</button>
            )}
          </div>
        ))}
        <Composer compact id={`comment-${post.id}`} placeholder="Add a course comment…"
          onSubmit={async (body) => {
            const { data } = await addComment({ variables: { postId: post.id, body } });
            return data?.createComment.errors[0]?.message ?? null;
          }} />
      </div>
    </li>
  );
}

/* ---------- join with a code ---------- */

/** Join someone's shared course with its code. A copy lands in your current semester. */
export function JoinCourseForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [join, { loading }] = useMutation<any>(JOIN_COURSE, { refetchQueries: [DASHBOARD, SEMESTERS] });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const { data } = await join({ variables: { code } });
    const p = data?.joinCourse;
    if (p?.errors?.length) return setError(p.errors[0].message);
    onDone();
    navigate(`/courses/${p.space.courseId}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <TextField label="Course code" value={code} maxLength={12} placeholder="e.g. K7M2QXA" autoFocus
        onChange={(e) => setCode(e.target.value)} error={error}
        aria-describedby="join-hint" />
      <p id="join-hint" className="text-xs text-slate-500">Ask your teacher or a group member. The course is added to your current semester.</p>
      <div className="flex gap-2">
        <Button disabled={loading || !code.trim()}>Join course</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

/* ---------- stream ---------- */

/** The stream of a shared course: everyone in it can post, attach files and comment.
 *  `courseId` is the viewer's own course id. */
export default function Stream({ courseId, mode }: { courseId: string; mode: "classroom" | "group"; canPost?: boolean }) {
  const { data } = useQuery<{ posts: StreamPost[] }>(POSTS, { variables: { courseId }, fetchPolicy: "cache-and-network" });
  const [createPost] = useMutation<any>(CREATE_POST, { refetchQueries: [POSTS] });
  const posts = data?.posts ?? [];

  return (
    <div className="space-y-4">
      <section aria-label="New post" className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <Composer id="new-post" allowFiles
          placeholder={mode === "group" ? "Share something with the group…" : "Share something with your class…"}
          onSubmit={async (body, files) => {
            let uploads;
            try {
              uploads = await Promise.all(files.map(async (f) => ({ name: f.name, content: await toBase64(f) })));
            } catch {
              return "Could not read one of the files.";
            }
            const { data } = await createPost({ variables: { courseId, body, files: uploads } });
            return data?.createPost.errors[0]?.message ?? null;
          }} />
      </section>
      {posts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">Nothing posted yet.</p>
      ) : (
        <ul className="space-y-4">{posts.map((p) => <PostCard key={p.id} post={p} />)}</ul>
      )}
    </div>
  );
}