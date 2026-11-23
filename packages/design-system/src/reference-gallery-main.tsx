import { createRoot } from "react-dom/client";
import { PantallasReferencia } from "./PantallasReferencia.js";
import type { PantallaReferenciaId } from "./MarcoTrabajo.js";

const requested = new URLSearchParams(location.search).get("screen") as PantallaReferenciaId | null;
createRoot(document.getElementById("root")!).render(<PantallasReferencia initial={requested ?? "portada"} />);
