import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { settings } from "../shared/settings";
import { applyTheme, watchSystem } from "./lib/theme";
import "./style.css";

document.title = settings.appName;
document.documentElement.style.setProperty("--accent", settings.accent);
applyTheme(); watchSystem();
createRoot(document.getElementById("root")!).render(<BrowserRouter><App /></BrowserRouter>);
