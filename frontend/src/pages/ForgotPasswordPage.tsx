import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@apollo/client/react";
import { REQUEST_RESET } from "../graphql/passwordReset";
import { AuthFrame } from "./ResetPasswordPage";

const COOLDOWN = 30;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [request, { loading }] = useMutation<any>(REQUEST_RESET);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter the email you signed up with.");
    try {
      await request({ variables: { email: email.trim() } });
      setSent(true);
      setWait(COOLDOWN);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    }
  }

  return (
    <AuthFrame title={sent ? "Check your email" : "Forgot password?"}>
      {sent ? (
        <div>
          <p role="status">If <b style={{ wordBreak: "break-all" }}>{email.trim()}</b> has a StudySync account, a reset link is on its way. It works once and expires in 1 hour.</p>
          <p>Nothing yet? Check your spam folder.</p>
          <button type="button" className="btn" disabled={wait > 0 || loading} onClick={submit}>
            {wait > 0 ? `Send again in ${wait}s` : "Send again"}
          </button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <p>Enter your email and we'll send you a link to choose a new password.</p>
          <input className="fld" type="email" placeholder="Email" aria-label="Email" autoComplete="email" autoFocus
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn ghost" disabled={loading}>{loading ? "Sending…" : "Send link"}</button>
          <p className="err" role="alert">{error}</p>
        </form>
      )}
      <Link className="back" to="/login">← Back to sign in</Link>
    </AuthFrame>
  );
}