import type { ReactNode } from "react";
import { BarSelect } from "./BarSelect.js";
import { Button } from "./Button.js";
import { StatusBadge } from "./StatusBadge.js";
import { WorkBar } from "./WorkBar.js";
import { WorkPage } from "./WorkPage.js";
import "./MarcoTrabajo.css";

export type PantallaReferenciaId = "portada" | "controles" | "control-panel" | "clasificacion" | "triage" | "cliente";

const etapas = ["Resumen", "Fuentes", "Clasificación", "Cálculo", "Controles · 2", "Cierre", "Actividad"];
const etapasActivas: Record<PantallaReferenciaId, string> = {
  portada: "Resumen", controles: "Controles · 2", "control-panel": "Controles · 2",
  clasificacion: "Clasificación", triage: "", cliente: "",
};

export function MarcoTrabajo({ children, screen = "portada" }: { children: ReactNode; screen?: PantallaReferenciaId }) {
  const legajo = !["triage", "cliente"].includes(screen);
  const tituloBarra = screen === "triage" ? "Bandeja documental" : "ZZ-AYUDA Restaurante Nuevo";
  const pageTitle = "octubre de 2026";
  const pageDescription = "Ingresos Brutos · vence el 20/11/2026 · revisión 1";
  const tabs = (
    <nav className="marco-trabajo__tabs" aria-label="Etapas del legajo">
      {etapas.map((etapa) => <Button key={etapa} type="button" variant="text" size="row" className={etapa === etapasActivas[screen] ? "marco-trabajo__tab marco-trabajo__tab--activa" : "marco-trabajo__tab"} aria-current={etapa === etapasActivas[screen] ? "page" : undefined}>{etapa}</Button>)}
    </nav>
  );
  const bar = (
    <WorkBar
      label={legajo ? "Período, revisión, estado, comentarios y acción" : "Navegación del trabajo"}
      context={legajo ? (
        <div className="marco-trabajo__context">
          <BarSelect label="Período fiscal" value="2026-10" onChange={() => undefined} options={[{ value: "2026-10", label: "octubre de 2026 · IIBB Tucumán" }]} />
          <span className="marco-trabajo__meta">Revisión 1 · Vence el 20/11/2026</span>
          <StatusBadge status="READY_TO_CALCULATE" label="Listo para calcular" />
        </div>
      ) : <div className="marco-trabajo__context"><span className="ds-text-help">{screen === "cliente" ? "Cliente" : "Estudio"}</span><strong>{tituloBarra}</strong></div>}
      action={legajo ? <><Button type="button" variant="text" size="row">Comentarios · 3</Button><Button type="button" variant="secondary" size="row">Acciones del período</Button><Button type="button" variant="primary">Calcular liquidación</Button></> : screen === "triage" ? <span className="ds-text-help">40 comprobantes · 8 controles · 3 percepciones</span> : undefined}
      sections={legajo ? tabs : undefined}
    />
  );
  const activeNav = screen === "cliente" ? "ZZ-AYUDA Restaurante Nuevo" : screen === "triage" ? "Bandeja documental" : "Legajo";
  return (
    <div className="marco-trabajo">
      <aside className="marco-trabajo__sidebar" aria-label="Navegación principal">
        <div className="marco-trabajo__brand">Contable</div>
        <nav>
          <div className="marco-trabajo__nav-label">Estudio</div>
          {["Inicio", "Clientes", "Pendientes para mí (2)", "Panel de trabajo"].map((label) => <Button key={label} type="button" variant="text" size="row" className="marco-trabajo__nav-item">{label}</Button>)}
          <div className="marco-trabajo__nav-label">Cliente</div>
          {["ZZ-AYUDA Restaurante Nuevo", "Bandeja documental", "Legajo", "Configuración fiscal"].map((label) => <Button key={label} type="button" variant="text" size="row" className={label === activeNav ? "marco-trabajo__nav-item marco-trabajo__nav-item--active" : "marco-trabajo__nav-item"} aria-current={label === activeNav ? "page" : undefined}>{label}</Button>)}
        </nav>
      </aside>
      <main className="marco-trabajo__main">
        <WorkPage bar={bar}>
          {screen === "triage" ? children : screen === "cliente" ? <div className="marco-trabajo__page">{children}</div> : (
            <div className="marco-trabajo__page">
              <div className="marco-trabajo__eyebrow ds-text-help">ZZ-AYUDA Restaurante Nuevo · Legajo mensual</div>
              <h1 className="ds-title-page">{pageTitle}</h1>
              <p className="ds-text-body">{pageDescription}</p>
              {children}
            </div>
          )}
        </WorkPage>
      </main>
    </div>
  );
}
