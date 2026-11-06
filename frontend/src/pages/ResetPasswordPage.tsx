import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@apollo/client/react";
import { PasswordInput, authCss } from "./AuthPage";
import { RESET_PASSWORD, RESET_VALID } from "../graphql/passwordReset";

/** Same look as the sign-in page: orange/grey split background and the soft grey card. */
export function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="gf">
      <style>{authCss}</style>
      <main className="box single">
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { data, loading, error: loadError, refetch } = useQuery<any>(RESET_VALID, { variables: { token }, skip: !token, fetchPolicy: "network-only" });
  const [reset, { loading: saving }] = useMutation<any>(RESET_PASSWORD);
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // the link holds a secret: don't let it leak to other sites through the Referer header
  useEffect(() => {
    const m = document.createElement("meta");
    m.name = "referrer"; m.content = "no-referrer";
    document.head.appendChild(m);
    return () => m.remove();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setFieldError(null);
    if (!pw) return setFieldError("Choose a new password.");
    if (pw !== again) return setFieldError("The two passwords don't match.");
    try {
      const { data } = await reset({ variables: { token, newPassword: pw } });
      const p = data.resetPassword;
      if (p.ok) { setDone(true); return; }
      const e0 = p.errors[0];
      if (e0.field === "newPassword") setFieldError(e0.message); else setError(e0.message);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    }
  }

  const expired = (
    <div>
      <p role="alert">This reset link has expired or was already used.</p>
      <Link className="btn ghost" to="/forgot-password">Get a new link</Link>
    </div>
  );

  let body: ReactNode;
  if (done) {
    body = (
      <div>
        <p role="status">Your password has been changed and you've been signed out everywhere else.</p>
        <Link className="btn ghost" to="/login">Sign in</Link>
      </div>
    );
  } else if (!token || (!loading && data && !data.passwordResetValid)) {
    body = expired;
  } else if (loadError) {
    body = <p role="alert">Couldn't check this link. <button type="button" className="btn" onClick={() => refetch()}>Try again</button></p>;
  } else if (loading || !data) {
    body = <p>Checking your link…</p>;
  } else {
    body = (
      <form onSubmit={submit} noValidate>
        <p>Choose a new password.</p>
        <PasswordInput placeholder="New password" aria-label="New password" autoComplete="new-password" autoFocus
          value={pw} onChange={(e) => setPw(e.target.value)} />
        <PasswordInput placeholder="Confirm new password" aria-label="Confirm new password" autoComplete="new-password"
          value={again} onChange={(e) => setAgain(e.target.value)} />
        <button className="btn ghost" disabled={saving}>{saving ? "Saving…" : "Change password"}</button>
        <p className="err" role="alert">
          {fieldError ?? error}{error && !fieldError && <> <Link to="/forgot-password" style={{ color: "inherit", fontWeight: 700 }}>Get a new link</Link></>}
        </p>
      </form>
    );
  }

  return <AuthFrame title={done ? "Password changed" : "Reset password"}>{body}</AuthFrame>;
}