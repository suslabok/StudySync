import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { gql } from "@apollo/client";
import { useMutation } from "@apollo/client/react";
import { useAuth } from "../auth/AuthContext";
import GoogleSignIn from "../components/GoogleSignIn";

const MIN_PASSWORD_LENGTH = 8;

const FIELDS = `accessToken user { id email displayName onboarded } errors { field code message }`;
const LOGIN = gql(`mutation Login($email:String!,$password:String!){ login(email:$email,password:$password){ ${FIELDS} } }`);
const REGISTER = gql(`mutation Register($email:String!,$password:String!,$displayName:String!){ register(email:$email,password:$password,displayName:$displayName){ ${FIELDS} } }`);

const css = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;700;800&display=swap');
.gf *,.gf *::before,.gf *::after{box-sizing:border-box}
.gf{
  --orange:#ffb20a;--orange-dark:#e69f00;--orange-light:#ffc84a;
  --base:#ececec;--shadow-d:#cfcfcf;--shadow-l:#ffffff;--ink:#111;
  min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;
  font-family:'Montserrat',Arial,sans-serif;
  background:linear-gradient(90deg,var(--orange) 50%,var(--base) 50%);
}
.gf .box{position:relative;width:768px;max-width:100%;min-height:500px;border-radius:22px;overflow:hidden;background:var(--base);box-shadow:0 14px 28px rgba(0,0,0,.25),0 10px 10px rgba(0,0,0,.22)}
.gf .pane{position:absolute;top:0;left:0;width:50%;height:100%;transition:transform .6s ease-in-out,opacity .6s}
.gf .pane form{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 40px;text-align:center;background:var(--base)}
.gf .in{z-index:2}
.gf .up{opacity:0;z-index:1}
.gf .box.right .in{transform:translateX(100%)}
.gf .box.right .up{transform:translateX(100%);opacity:1;z-index:5}
.gf h1{margin:0 0 18px;font-size:30px;font-weight:800;color:var(--ink)}
.gf .social{display:flex;flex-direction:column;align-items:center;margin-bottom:18px;max-width:100%;color-scheme:light}
.gf .divider{width:100%;display:flex;align-items:center;gap:10px;margin:0 0 14px;font-size:11px;font-weight:500;color:#888}
.gf .divider::before,.gf .divider::after{content:"";flex:1;height:1px;background:var(--shadow-d)}
.gf input.fld{width:100%;height:42px;margin:0 0 14px;padding:0 16px;border:0;border-radius:10px;background:var(--base);
  font:500 12px 'Montserrat',sans-serif;color:var(--ink);box-shadow:6px 6px 12px var(--shadow-d),-6px -6px 12px var(--shadow-l)}
.gf input.fld::placeholder{color:#888}
.gf input.fld:focus{outline:none;box-shadow:inset 4px 4px 8px var(--shadow-d),inset -4px -4px 8px var(--shadow-l)}
.gf .btn{display:inline-flex;align-items:center;justify-content:center;margin-top:4px;min-width:140px;height:42px;padding:0 28px;border:0;border-radius:12px;
  background:var(--base);color:#444;text-decoration:none;font:700 11px 'Montserrat',sans-serif;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;
  box-shadow:6px 6px 12px var(--shadow-d),-6px -6px 12px var(--shadow-l);transition:box-shadow .2s}
.gf .btn:active{box-shadow:inset 3px 3px 6px var(--shadow-d),inset -3px -3px 6px var(--shadow-l)}
.gf .btn:disabled{opacity:.6;cursor:not-allowed}
.gf .btn.ghost{background:var(--orange);color:#fff;box-shadow:6px 6px 12px var(--orange-dark),-6px -6px 12px var(--orange-light)}
.gf .btn.ghost:active{box-shadow:inset 3px 3px 6px var(--orange-dark),inset -3px -3px 6px var(--orange-light)}
.gf .err{min-height:16px;margin:8px 0 0;font-size:11px;font-weight:500;color:#c0392b}
.gf .btn:focus-visible,.gf a:focus-visible{outline:2px solid #333;outline-offset:3px}
.gf .ov-wrap{position:absolute;top:0;left:50%;width:50%;height:100%;overflow:hidden;transition:transform .6s ease-in-out;z-index:100}
.gf .box.right .ov-wrap{transform:translateX(-100%)}
.gf .ov{position:relative;left:-100%;width:200%;height:100%;background:var(--orange);color:#fff;transition:transform .6s ease-in-out}
.gf .box.right .ov{transform:translateX(50%)}
.gf .ov-pane{position:absolute;top:0;width:50%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 36px;text-align:center;transition:transform .6s ease-in-out}
.gf .ov-pane h2{margin:0 0 14px;font-size:30px;line-height:1.15;font-weight:800}
.gf .ov-pane p{margin:0 0 22px;font-size:14px;font-weight:500;opacity:.95}
.gf .ov-left{transform:translateX(-20%)}
.gf .ov-right{right:0}
.gf .box.right .ov-left{transform:translateX(0)}
.gf .box.right .ov-right{transform:translateX(20%)}
.gf .pw{position:relative;width:100%}
.gf .pw input.fld{padding-right:46px}
.gf .pw input::-ms-reveal{display:none}
.gf .eye{position:absolute;top:0;right:6px;width:36px;height:42px;display:grid;place-items:center;border:0;border-radius:10px;background:none;color:#777;cursor:pointer}
.gf .eye:hover{color:var(--ink)}
.gf .eye:focus-visible{outline:2px solid #333;outline-offset:-2px}
@media (max-width:600px){
  .gf .pane form{padding:0 16px}
  .gf h1,.gf .ov-pane h2{font-size:22px}
  .gf .ov-pane{padding:0 14px}.gf .ov-pane p{font-size:12px}
  .gf .btn{min-width:0;padding:0 16px}
}
@media (prefers-reduced-motion:reduce){.gf *{transition:none!important}}
`;

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw">
      <input {...props} className="fld" type={show ? "text" : "password"} />
      <button type="button" className="eye" onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} tabIndex={props.tabIndex}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {show ? (
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24M1 1l22 22" />
          ) : (
            <>
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  const isRegister = mode === "register";
  const [run, { loading }] = useMutation<any>(isRegister ? REGISTER : LOGIN, { context: { skipRefresh: true } });
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as any;
  const [form, setForm] = useState({ email: "", password: "", displayName: "" });
  const [error, setError] = useState<string | null>(null);

  // Clear the error when the person slides between sign in and register.
  useEffect(() => setError(null), [mode]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { data } = await run({ variables: isRegister ? form : { email: form.email, password: form.password } });
      const payload = data[isRegister ? "register" : "login"];
      if (payload.errors.length) return setError(payload.errors[0].message);
      signIn(payload.accessToken, payload.user);
      navigate(location.state?.from?.pathname ?? "/", { replace: true });
    } catch {
      setError("Could not reach the server. Is the API running?");
    }
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <div className="gf">
      <style>{css}</style>
      <main className={"box" + (isRegister ? " right" : "")}>
        {/* Register form: slides in on the right */}
        <div className="pane up" aria-hidden={!isRegister}>
          <form onSubmit={onSubmit}>
            <h1>Create Account</h1>
            <div className="social"><GoogleSignIn /></div>
            <div className="divider">or</div>
            <input className="fld" placeholder="Display name" aria-label="Display name" autoComplete="name"
              value={form.displayName} onChange={set("displayName")} required tabIndex={isRegister ? 0 : -1} />
            <input className="fld" type="email" placeholder="Email" aria-label="Email" autoComplete="email"
              value={form.email} onChange={set("email")} required tabIndex={isRegister ? 0 : -1} />
            <PasswordInput placeholder={`Password (${MIN_PASSWORD_LENGTH}+ characters)`} aria-label="Password" autoComplete="new-password"
              value={form.password} onChange={set("password")} required minLength={MIN_PASSWORD_LENGTH} tabIndex={isRegister ? 0 : -1} />
            <button className="btn" disabled={loading} tabIndex={isRegister ? 0 : -1}>
              {loading ? "Please wait…" : "Sign up"}
            </button>
            <p className="err" role={isRegister ? "alert" : undefined}>{isRegister && error}</p>
          </form>
        </div>

        {/* Sign in form: default on the left */}
        <div className="pane in" aria-hidden={isRegister}>
          <form onSubmit={onSubmit}>
            <h1>Sign in</h1>
            <div className="social"><GoogleSignIn /></div>
            <div className="divider">or</div>
            <input className="fld" type="email" placeholder="Email" aria-label="Email" autoComplete="email"
              value={form.email} onChange={set("email")} required tabIndex={isRegister ? -1 : 0} />
            {/* No minLength here: login must never reject an existing password client-side */}
            <PasswordInput placeholder="Password" aria-label="Password" autoComplete="current-password"
              value={form.password} onChange={set("password")} required tabIndex={isRegister ? -1 : 0} />
            <button className="btn" disabled={loading} tabIndex={isRegister ? -1 : 0}>
              {loading ? "Please wait…" : "Sign in"}
            </button>
            <p className="err" role={!isRegister ? "alert" : undefined}>{!isRegister && error}</p>
          </form>
        </div>

        {/* Sliding orange overlay: the buttons change the route, the CSS does the slide */}
        <div className="ov-wrap">
          <div className="ov">
            <div className="ov-pane ov-left">
              <h2>Welcome Back!</h2>
              <p>Already have an account?</p>
              <Link className="btn ghost" to="/login" tabIndex={isRegister ? 0 : -1}>Sign in</Link>
            </div>
            <div className="ov-pane ov-right">
              <h2>Welcome To StudySync!</h2>
              <p>New Here?</p>
              <Link className="btn ghost" to="/register" tabIndex={isRegister ? -1 : 0}>Sign up</Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}