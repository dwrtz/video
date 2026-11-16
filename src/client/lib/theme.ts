export type ThemePref = "light" | "dark" | "system";
const mq = () => window.matchMedia("(prefers-color-scheme: dark)");
export const getPref = (): ThemePref => (["light", "dark", "system"].includes(localStorage.getItem("av.theme") ?? "") ? localStorage.getItem("av.theme") as ThemePref : "system");
export function applyTheme(pref = getPref()) {
  const dark = pref === "dark" || (pref === "system" && mq().matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
export function setPref(p: ThemePref) { localStorage.setItem("av.theme", p); applyTheme(p); }
export function watchSystem() { mq().addEventListener("change", () => applyTheme()); }
