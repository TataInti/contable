import type { ReactNode } from "react";
import { Button } from "./Button.js";
import { StatusBadge } from "./StatusBadge.js";
import { WorkBar } from "./WorkBar.js";
import { WorkPage } from "./WorkPage.js";
import "./MarcoTrabajo.css";

const etapas = ["Resumen", "Fuentes", "Clasificación", "Cálculo", "Controles · 2", "Cierre", "Actividad"];

export function MarcoTrabajo({ children }: { children: ReactNode }) {
  const tabs = (
    <nav className="marco-trabajo__tabs" aria-label="Etapas del legajo">
      {etapas.map((etapa, index) => (
        <button key={etapa} type="button" aria-current={index === 0 ? "page" : undefined}>
          {etapa}
        </button>
      ))}
    </nav>
  );
  const bar = (
    <WorkBar
      label="Período, revisión, estado, comentarios y acción"
      context={
        <div className="marco-trabajo__context">
          <label className="marco-trabajo__periodo">
            <span className="marco-trabajo__sr-only">Período fiscal</span>
            <input aria-label="Buscar período fiscal" value="octubre de 2026 · IIBB Tucumán" readOnly />
          </label>
          <span className="marco-trabajo__meta">Revisión 1 · Vence el 20/11/2026</span>
          <span className="marco-trabajo__status-dot" aria-hidden="true" />
          <StatusBadge status="READY_TO_CALCULATE" label="Listo para calcular" />
          <button className="marco-trabajo__comments" type="button">Comentarios · 3</button>
        </div>
      }
      action={
        <>
          <button className="marco-trabajo__period-action" type="button">Acciones del período</button>
          <Button type="button" variant="primary">Calcular liquidación</Button>
        </>
      }
      sections={tabs}
    />
  );

  return (
    <div className="marco-trabajo">
      <aside className="marco-trabajo__sidebar" aria-label="Navegación principal">
        <div className="marco-trabajo__brand">Contable</div>
        <nav>
          <div className="marco-trabajo__nav-label">Estudio</div>
          {[["Inicio", false], ["Clientes", false], ["Pendientes para mí (2)", false], ["Panel de trabajo", false]].map(([label]) => (
            <button key={label as string} type="button">{label as string}</button>
          ))}
          <div className="marco-trabajo__nav-label">Cliente</div>
          {[["ZZ-AYUDA Restaurante Nuevo", false], ["Bandeja documental", false], ["Legajo", true], ["Configuración fiscal", false]].map(([label, active]) => (
            <button key={label as string} type="button" aria-current={active ? "page" : undefined}>{label as string}</button>
          ))}
        </nav>
      </aside>
      <main className="marco-trabajo__main">
        <WorkPage bar={bar}>
          <div className="marco-trabajo__page">
            <div className="marco-trabajo__eyebrow">ZZ-AYUDA Restaurante Nuevo · Legajo mensual</div>
            <h1>octubre de 2026</h1>
            <p>Ingresos Brutos · vence el 20/11/2026 · revisión 1</p>
            {children}
          </div>
        </WorkPage>
      </main>
    </div>
  );
}
