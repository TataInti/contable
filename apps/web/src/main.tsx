import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/fonts.css";
import "@contable/design-system/tokens.css";
import "./styles/global.css";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Elemento #root no encontrado");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
