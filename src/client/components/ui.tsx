import { useEffect, useRef, useState } from "react";
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number>(0);
  return { msg, show: (m: string) => { setMsg(m); clearTimeout(t.current); t.current = window.setTimeout(() => setMsg(null), 2600); } };
}
export function Toast({ msg }: { msg: string | null }) {
  return <div className={`toast ${msg ? "show" : ""}`} role="status" aria-live="polite">{msg}</div>;
}
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); ref.current?.querySelector<HTMLElement>("input, textarea, button")?.focus();
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
export function Confirm({ title, body, confirm, onConfirm, onCancel }: { title: string; body: string; confirm: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="muted">{body}</p>
      <div className="modal-actions"><button className="btn btn-ghost" onClick={onCancel}>Cancel</button><button className="btn btn-danger" onClick={onConfirm}>{confirm}</button></div>
    </Modal>
  );
}
