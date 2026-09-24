import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AppBoundary from "./components/AppBoundary";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing");
createRoot(root).render(<StrictMode><AppBoundary><App /></AppBoundary></StrictMode>);
