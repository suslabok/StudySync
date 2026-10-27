import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@apollo/client/react";
import { useAuth } from "../auth/AuthContext";
import {
  AppShell, Banner, Button, Card, LoadError, SemesterNav, SemesterSummary, toFieldErrors,
} from "../components/AppShell";
import Avatar from "../components/Avatar";
import TextField from "../components/TextField";
import { DASHBOARD, SEMESTERS, type DashboardData, type SemestersData } from "../graphql/dashboard";
import {
  CHANGE_PASSWORD, PROFILE, REMOVE_AVATAR, UPDATE_PROFILE, UPLOAD_AVATAR,
  type Profile, type ProfileData,
} from "../graphql/profile";

// Keep in sync with MIN_PASSWORD_LENGTH in backend/app/auth.py
const MIN_PASSWORD_LENGTH = 8;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const ZONES: string[] = (() => {
  try { return (Intl as any).supportedValuesOf("timeZone") as string[]; } catch { return ["UTC"]; }
})();
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Centre-crop to a square and shrink to 512px JPEG so the upload is only ~50-100 KB. */
async function toSquareJpeg(file: File, size = 512): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.88);
}

/* small building blocks */
function PencilButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className="grid h-7 w-7 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-plum-800">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    </button>
  );
}

function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <h2 className="text-lg font-extrabold">{children}</h2>
      {action}
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-b-0">
      <dt className="shrink-0 text-xs text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

/* left card: photo, name, email */
function ProfileCard({ profile }: { profile: Profile }) {
  const { updateUser } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [upload, { loading: uploading }] = useMutation<any>(UPLOAD_AVATAR);
  const [remove, { loading: removing }] = useMutation<any>(REMOVE_AVATAR);
  const busy = uploading || removing;

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";                       // lets the same file be picked again
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) return setError("Choose an image file (JPG, PNG or WebP).");
    if (file.size > MAX_PHOTO_BYTES) return setError("That image is larger than 10 MB.");
    try {
      const image = await toSquareJpeg(file);
      const { data } = await upload({ variables: { image } });
      const p = data.uploadAvatar;
      if (p.errors.length) return setError(p.errors[0].message);
      updateUser({ avatarUrl: p.user.avatarUrl });
    } catch (err) {
      console.error(err);
      setError("Could not upload that image. Try a different one.");
    }
  }

  async function onRemove() {
    setError(null);
    try {
      const { data } = await remove();
      updateUser({ avatarUrl: data.removeAvatar.user.avatarUrl });
    } catch (err) {
      console.error(err);
      setError("Could not remove your photo. Please try again.");
    }
  }

  return (
    <Card className="flex flex-col items-center text-center">
   <Avatar name={profile.displayName} url={profile.avatarUrl} size={128} />
<p className="mt-4 max-w-full truncate text-xl font-extrabold">{profile.displayName}</p>
 <p className="max-w-full truncate text-xs font-medium text-plum-800">{profile.email}</p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp"
          onChange={onPick} className="hidden" aria-label="Choose profile photo" />
        <Button type="button" variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
          {uploading ? "Uploading…" : profile.avatarUrl ? "Change photo" : "Upload photo"}
        </Button>
        {profile.avatarUrl && (
          <button type="button" disabled={busy} onClick={onRemove}
            className="text-sm font-medium text-slate-500 underline hover:text-red-600 disabled:opacity-60">
            {removing ? "Removing…" : "Remove"}
          </button>
        )}
      </div>
      {error && <div className="mt-4 w-full"><Banner>{error}</Banner></div>}
    </Card>
  );
}

/* middle card: general information (view + edit) */
function EditForm({ profile, onCancel, onSaved }: { profile: Profile; onCancel: () => void; onSaved: () => void }) {
  const { updateUser } = useAuth();
  const [name, setName] = useState(profile.displayName);
  const [tz, setTz] = useState(profile.timezone);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [run, { loading }] = useMutation<any>(UPDATE_PROFILE, {
    refetchQueries: ["Profile"],
    awaitRefetchQueries: true,
  });
  const zones = ZONES.includes(tz) ? ZONES : [tz, ...ZONES];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    try {
      const { data } = await run({ variables: { displayName: name, timezone: tz } });
      const p = data.updateProfile;
      if (p.errors.length) return setErrors(toFieldErrors(p.errors, ["displayName", "timezone"]));
      updateUser({ displayName: p.user.displayName });   // sidebar / avatar update immediately
      onSaved();
    } catch (err) {
      console.error(err);
      setErrors({ form: "Something went wrong. Please try again." });
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <TextField label="Display name" value={name} onChange={(e) => setName(e.target.value)}
        error={errors.displayName} autoComplete="name" required />
      <TextField label="Email" value={profile.email} readOnly disabled />

      <div>
        <label htmlFor="tz" className="mb-1.5 block text-sm font-medium text-slate-700">Timezone</label>
        <select id="tz" value={tz} onChange={(e) => setTz(e.target.value)}
          aria-invalid={!!errors.timezone}
          className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200">
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        {errors.timezone && <p className="mt-1.5 text-sm text-red-600">{errors.timezone}</p>}
        <button type="button" onClick={() => setTz(browserZone())}
          className="mt-2 text-sm font-medium text-plum-800 underline">
          Use my browser's timezone ({browserZone()})
        </button>
      </div>

      {errors.form && <Banner>{errors.form}</Banner>}
      <div className="flex gap-3">
        <Button disabled={loading}>{loading ? "Saving…" : "Save changes"}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function GeneralInfo({ profile, editing, saved, onEdit, onCancel, onSaved }: {
  profile: Profile; editing: boolean; saved: boolean;
  onEdit: () => void; onCancel: () => void; onSaved: () => void;
}) {
  const since = new Date(profile.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  let localTime = "";
  try {
    localTime = new Date().toLocaleTimeString(undefined, { timeZone: profile.timezone, hour: "numeric", minute: "2-digit" });
  } catch { /* invalid zone: skip the row */ }

  return (
    <Card>
      <CardTitle action={!editing && <PencilButton label="Edit general information" onClick={onEdit} />}>
        General information
      </CardTitle>
      {saved && !editing && <div className="mb-3"><Banner kind="ok">Profile saved.</Banner></div>}

      {editing ? (
        <EditForm profile={profile} onCancel={onCancel} onSaved={onSaved} />
      ) : (
        <dl>
          <InfoRow label="Display name">{profile.displayName}</InfoRow>
          <InfoRow label="Email">{profile.email}</InfoRow>
          <InfoRow label="Timezone">{profile.timezone}</InfoRow>
          {localTime && <InfoRow label="Local time">{localTime}</InfoRow>}
          <InfoRow label="Member since">{since}</InfoRow>
        </dl>
      )}
    </Card>
  );
}

/* bottom card: tabs (password / sign-in methods) */
function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [run, { loading }] = useMutation<any>(CHANGE_PASSWORD, { refetchQueries: ["Profile"] });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setDone(false);
    if (next.length < MIN_PASSWORD_LENGTH)
      return setErrors({ newPassword: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    if (next !== confirm) return setErrors({ confirm: "Passwords do not match" });
    try {
      const { data } = await run({
        variables: { currentPassword: hasPassword ? current : null, newPassword: next },
      });
      const p = data.changePassword;
      if (p.errors.length) return setErrors(toFieldErrors(p.errors, ["currentPassword", "newPassword"]));
      setCurrent(""); setNext(""); setConfirm("");
      setDone(true);
    } catch (err) {
      console.error(err);
      setErrors({ form: "Something went wrong. Please try again." });
    }
  }

  return (
    <div className="max-w-md">
      <p className="mb-5 text-sm text-slate-500">
        {hasPassword
          ? "Changing your password signs you out everywhere else."
          : "You currently sign in with Google. Set a password to also sign in with your email."}
      </p>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {hasPassword && (
          <TextField label="Current password" type="password" autoComplete="current-password"
            value={current} onChange={(e) => setCurrent(e.target.value)} error={errors.currentPassword} required />
        )}
        <TextField label="New password" type="password" autoComplete="new-password"
          placeholder={`${MIN_PASSWORD_LENGTH}+ characters`}
          value={next} onChange={(e) => setNext(e.target.value)} error={errors.newPassword} required />
        <TextField label="Confirm new password" type="password" autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} required />

        {errors.form && <Banner>{errors.form}</Banner>}
        {done && <Banner kind="ok">{hasPassword ? "Password changed." : "Password set. You can now sign in with email and password."}</Banner>}
        <Button disabled={loading}>
          {loading ? "Saving…" : hasPassword ? "Change password" : "Set password"}
        </Button>
      </form>
    </div>
  );
}

function SignInMethods({ profile, onSetPassword }: { profile: Profile; onSetPassword: () => void }) {
  const rows = [
    {
      name: "Email & password", detail: "Sign in with your email and a password",
      on: profile.hasPassword, onLabel: "Active", offLabel: "Not set",
      accent: "border-plum-800 bg-plum-800/5",
    },
    {
      name: "Google", detail: "Sign in with your Google account",
      on: profile.googleLinked, onLabel: "Connected", offLabel: "Not connected",
      accent: "border-sun-400 bg-sun-300/20",
    },
  ];
  return (
    <div>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.name}
            className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border-l-4 px-4 py-3 ${r.accent}`}>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{r.name}</p>
              <p className="text-xs text-slate-500">{r.detail}</p>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
              r.on ? "bg-green-600 text-white" : "bg-slate-200 text-slate-600"}`}>
              {r.on ? r.onLabel : r.offLabel}
            </span>
          </li>
        ))}
      </ul>
      {!profile.hasPassword && (
        <button type="button" onClick={onSetPassword} className="mt-4 text-sm font-medium text-plum-800 underline">
          Set a password
        </button>
      )}
    </div>
  );
}

type Tab = "password" | "methods";

function SecurityCard({ profile }: { profile: Profile }) {
  const [tab, setTab] = useState<Tab>("password");
  const tabs: [Tab, string][] = [
    ["password", profile.hasPassword ? "Change password" : "Set password"],
    ["methods", "Sign-in methods"],
  ];

  return (
    <Card>
      <div role="tablist" aria-label="Security" className="mb-6 flex gap-6 border-b border-slate-100">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 pb-3 text-sm font-semibold transition ${
              tab === id ? "border-plum-800 text-plum-800" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "password"
          ? <PasswordForm hasPassword={profile.hasPassword} />
          : <SignInMethods profile={profile} onSetPassword={() => setTab("password")} />}
      </div>
    </Card>
  );
}

/*  page - Profile */
export default function ProfilePage() {
  const navigate = useNavigate();
  const { data, error, refetch } = useQuery<ProfileData>(PROFILE, { fetchPolicy: "network-only" });
  const { data: dash } = useQuery<DashboardData>(DASHBOARD, { fetchPolicy: "cache-and-network" });
  const { data: semData } = useQuery<SemestersData>(SEMESTERS, { fetchPolicy: "cache-and-network" });
  const sem = dash?.dashboard.currentSemester ?? null;

  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const startEdit = () => { setSaved(false); setEditing(true); };

  return (
    <AppShell
      semesterNav={sem && (
        <SemesterNav semesters={semData?.semesters ?? []} current={sem}
          onSelect={(id) => navigate("/", { state: id === sem.id ? null : { viewSemesterId: id } })}
          onNew={() => navigate("/", { state: { newSemester: true } })} />
      )}
      main={
        <div className="space-y-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Your profile</h1>
            {data && (
              <Button variant={editing ? "secondary" : "primary"}
                onClick={() => (editing ? setEditing(false) : startEdit())}>
                {editing ? "Cancel" : "Edit"}
              </Button>
            )}
          </header>

          {!data ? (
            error
              ? <LoadError what="profile" onRetry={() => refetch()} />
              : <p className="text-slate-500">Loading…</p>
          ) : (
            <>
<div className="grid gap-6 md:grid-cols-2">
                <ProfileCard profile={data.me} />
                <GeneralInfo profile={data.me} editing={editing} saved={saved}
                  onEdit={startEdit}
                  onCancel={() => setEditing(false)}
                  onSaved={() => { setEditing(false); setSaved(true); }} />
              </div>
              <SecurityCard profile={data.me} />
            </>
          )}
        </div>
      }
      side={dash ? <SemesterSummary shown={sem} courses={dash.dashboard.courses} /> : null}
    />
  );
}