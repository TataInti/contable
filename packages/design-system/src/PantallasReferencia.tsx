import { ControlesListaDemo, ControlesPanelDemo, PortadaDemo, TriageDemo, PaginaClienteDemo, ClasificacionDemo } from "./Patrones.fixtures.js";
import { MarcoTrabajo, type PantallaReferenciaId } from "./MarcoTrabajo.js";
import "./PantallasReferencia.css";

const pantallas: readonly PantallaReferenciaId[] = ["portada", "controles", "control-panel", "clasificacion", "triage", "cliente"];

export function PantallasReferencia({ initial = "portada" }: { initial?: PantallaReferenciaId }) {
  const selected = pantallas.includes(initial) ? initial : "portada";
  let content;
  switch (selected) {
    case "portada": content = <PortadaDemo />; break;
    case "controles": content = <ControlesListaDemo />; break;
    case "control-panel": content = <ControlesPanelDemo initiallyOpen />; break;
    case "clasificacion": content = <ClasificacionDemo />; break;
    case "triage": content = <TriageDemo />; break;
    case "cliente": content = <PaginaClienteDemo />; break;
  }
  return <MarcoTrabajo screen={selected}>{content}</MarcoTrabajo>;
}

export { pantallas };
