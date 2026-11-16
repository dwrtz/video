import inputs from "../../spekkr.inputs.json";
const hex = /^#[0-9a-fA-F]{6}$/;
export const settings = {
  appName: String((inputs as any).app_name || "Async Video").slice(0, 40),
  accent: hex.test((inputs as any).accent_color) ? (inputs as any).accent_color as string : "#0d9488",
};
