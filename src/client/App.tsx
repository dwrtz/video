import { createContext, useContext, useEffect, useState } from "react";
import { Route, Routes, Link, useNavigate } from "react-router-dom";
import type { Me } from "../shared/types";
import { api, getMe } from "./lib/api";
import { settings } from "../shared/settings";
import { getPref, setPref, type ThemePref } from "./lib/theme";
import { IconMonitor, IconMoon, IconSignOut, IconSun } from "./components/Icons";
import { AuthPage } from "./pages/Auth";
import { LibraryPage } from "./pages/Library";
import { RecorderPage } from "./pages/Recorder";
import { WatchPage } from "./pages/Watch";

type Ctx = { me: Me | null; setMe: (m: Me | null) => void };
const AuthCtx = createContext<Ctx>({ me: null, setMe: () => {} });
export const useAuth = () => useContext(AuthCtx);

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => { getMe().then(setMe).catch(() => setMe(null)); }, []);
  if (me === undefined) return <div className="boot" aria-busy="true" />;
  return (
    <AuthCtx.Provider value={{ me, setMe }}>
      <Routes>
        <Route path="/" element={me ? <LibraryPage /> : <AuthPage />} />
        <Route path="/signin" element={<AuthPage />} />
        <Route path="/record" element={me ? <RecorderPage /> : <AuthPage />} />
        <Route path="/v/:id" element={<WatchPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthCtx.Provider>
  );
}

export function Brand() {
  return <Link to="/" className="brand" aria-label={`${settings.appName} home`}><span className="brand-mark" aria-hidden="true"><span /></span><span className="brand-name">{settings.appName}</span></Link>;
}

export function ThemeToggle() {
  const [pref, setP] = useState<ThemePref>(getPref());
  const order: ThemePref[] = ["system", "light", "dark"];
  const next = order[(order.indexOf(pref) + 1) % 3];
  const Icon = pref === "light" ? IconSun : pref === "dark" ? IconMoon : IconMonitor;
  return <button className="icon-btn" title={`Theme: ${pref}`} aria-label={`Theme: ${pref}. Switch to ${next}`} onClick={() => { setPref(next); setP(next); }}><Icon size={18} /></button>;
}

export function TopBar({ children }: { children?: React.ReactNode }) {
  const { me, setMe } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <header className="topbar">
      <Brand />
      <div className="topbar-mid">{children}</div>
      <div className="topbar-end">
        <ThemeToggle />
        {me ? (
          <div className="menu-wrap">
            <button className="avatar-btn" aria-label="Account" aria-expanded={open} onClick={() => setOpen(o => !o)}><Avatar name={me.name} /></button>
            {open && (
              <div className="menu" role="menu" onMouseLeave={() => setOpen(false)}>
                <div className="menu-head"><strong>{me.name}</strong><span>{me.email}</span></div>
                <button role="menuitem" onClick={async () => { await api("/api/auth/signout", { method: "POST" }); setMe(null); nav("/"); }}><IconSignOut size={16} /> Sign out</button>
              </div>
            )}
          </div>
        ) : <Link className="btn btn-ghost" to="/signin">Sign in</Link>}
      </div>
    </header>
  );
}

const HUES = [12, 32, 145, 175, 200, 225, 262, 290, 330];
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const h = HUES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join("") || "?";
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${h} 60% 46%)` }} aria-hidden="true">{initials}</span>;
}

function NotFound() {
  return <div className="page"><TopBar /><main className="empty-page"><h1>Page not found</h1><p>The link may be wrong, or the video was deleted.</p><Link className="btn btn-primary" to="/">Go home</Link></main></div>;
}
