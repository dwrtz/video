import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth, Brand, ThemeToggle } from "../App";
import { settings } from "../../shared/settings";
import type { Me } from "../../shared/types";
import { IconPlay } from "../components/Icons";

export function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [form, setForm] = useState({ email: "", name: "", password: "" });
  const [err, setErr] = useState<{ message: string; fields?: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const { setMe } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await api<{ user: Me }>(`/api/auth/${mode}`, { method: "POST", body: mode === "signup" ? form : { email: form.email, password: form.password } });
      setMe(r.user);
      if (loc.pathname === "/signin") nav("/");
    } catch (e) { setErr(e instanceof ApiError ? { message: e.message, fields: e.fields } : { message: "Something went wrong" }); }
    finally { setBusy(false); }
  };
  const f = (k: keyof typeof form) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value }), "aria-invalid": !!err?.fields?.[k] });
  return (
    <div className="auth">
      <section className="auth-hero" aria-hidden="true">
        <div className="auth-hero-top"><Brand /></div>
        <div className="auth-hero-copy">
          <h2>Say it with a video.</h2>
          <p>Record your screen and camera, share a link, and get replies pinned to the exact moment.</p>
        </div>
        <div className="hero-mock">
          <div className="hero-mock-screen">
            <div className="hm-bar"><i /><i /><i /></div>
            <div className="hm-body"><div className="hm-col"><b /><b /><b className="short" /></div><div className="hm-chart">{[38, 62, 48, 80, 56, 92, 70].map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}</div></div>
            <div className="hm-bubble" />
            <div className="hm-play"><IconPlay size={22} /></div>
          </div>
          <div className="hm-comments">
            <div className="hm-c"><span className="hm-av" style={{ background: "hsl(200 60% 46%)" }}>AK</span><div><b>Asha</b> <em>0:42</em><p>This flow is so much clearer now 🙌</p></div></div>
            <div className="hm-c"><span className="hm-av" style={{ background: "hsl(330 60% 46%)" }}>RL</span><div><b>Ravi</b> <em>1:15</em><p>Can we ship this on Friday?</p></div></div>
          </div>
        </div>
      </section>
      <main className="auth-main">
        <div className="auth-top"><ThemeToggle /></div>
        <form className="auth-card" onSubmit={submit} noValidate>
          <h1>{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
          <p className="muted">{mode === "signin" ? `Sign in to record and manage your videos in ${settings.appName}.` : "Anyone with a link can watch your videos. Only you can record and edit them."}</p>
          <div className="seg" role="tablist">
            <button type="button" role="tab" aria-selected={mode === "signin"} onClick={() => { setMode("signin"); setErr(null); }}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === "signup"} onClick={() => { setMode("signup"); setErr(null); }}>Create account</button>
          </div>
          {mode === "signup" && <label className="field"><span>Name</span><input autoComplete="name" {...f("name")} />{err?.fields?.name && <small>{err.fields.name}</small>}</label>}
          <label className="field"><span>Email</span><input type="email" autoComplete="email" {...f("email")} />{err?.fields?.email && <small>{err.fields.email}</small>}</label>
          <label className="field"><span>Password</span><input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} {...f("password")} />{err?.fields?.password && <small>{err.fields.password}</small>}</label>
          {err && !Object.values(err.fields ?? {}).includes(err.message) && <div className="alert" role="alert">{err.message}</div>}
          <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button>
        </form>
      </main>
    </div>
  );
}
