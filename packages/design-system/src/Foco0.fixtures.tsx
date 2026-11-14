/*
 * Casos de marcado para la prueba de cero cambio de Foco 0.
 * Cada caso usa las props con las que hoy se escribe el componente en apps/web/src
 * (ver los comentarios por caso). DenseSection no tiene consumidores todavía:
 * su caso usa las props del contrato. No cambiar sin regenerar la línea base.
 */
import type { ReactElement } from "react";
import { Button } from "./Button.js";
import {
  DenseFooter,
  DenseSection,
  DenseTable,
  DenseWorkspace,
  Inspector,
  StatStrip,
  type DenseColumn,
  type DenseGroup,
} from "./Dense.js";
import { EmptyState } from "./EmptyState.js";

interface FixtureRow {
  id: string;
  name: string;
  amount: number;
  status: "ACTIVE" | "INACTIVE";
}

const rows: FixtureRow[] = [
  { id: "c-1", name: "Cliente sintético A", amount: 2, status: "ACTIVE" },
  { id: "c-2", name: "Cliente sintético B", amount: 0, status: "INACTIVE" },
];

const columns: DenseColumn<FixtureRow>[] = [
  { key: "name", header: "Nombre", render: (row) => row.name, sortValue: (row) => row.name },
  {
    key: "amount",
    header: "Cantidad",
    render: (row) => row.amount,
    sortValue: (row) => row.amount,
    align: "right",
  },
  { key: "status", header: "Estado", render: (row) => row.status, secondary: true },
];

const groupByStatus = (row: FixtureRow): DenseGroup => ({
  key: row.status,
  label: row.status === "ACTIVE" ? "Activos" : "Inactivos",
  order: row.status === "ACTIVE" ? 0 : 1,
});

export const FOCO0_CASES: Record<string, () => ReactElement> = {
  // Contrato de DenseSection (sin consumidores en apps/web/src).
  "dense-section": () => (
    <DenseSection
      id="pendientes"
      title="Pendientes"
      count={2}
      description="Para revisar"
      actions={
        <Button type="button" variant="secondary" size="row">
          Exportar
        </Button>
      }
    >
      <p>Contenido de la sección</p>
    </DenseSection>
  ),
  // Como PendingFilingReceipts.tsx: tabla sin selección ni grupos, con pie.
  "dense-table-plana": () => (
    <DenseTable<FixtureRow>
      label="Constancias pendientes"
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      footer={<DenseFooter count={rows.length} noun="constancias" newShortcut={false} />}
    />
  ),
  // Como StudyClientes.tsx: agrupada, con selección, detalle abierto, pie y vacío compacto.
  "dense-table-agrupada-seleccion": () => (
    <DenseTable<FixtureRow>
      label="Cartera de clientes"
      groupBy={groupByStatus}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      selectedKey="c-1"
      onSelect={() => undefined}
      inspectorOpen
      rowClassName={(row) => (row.status === "ACTIVE" ? undefined : "dense-row--muted")}
      footer={
        <DenseFooter count={rows.length} noun="clientes" hint="Elegí una fila para ver la ficha" />
      }
      empty={<EmptyState size="compact" title="Sin clientes" />}
    />
  ),
  // Tabla sin filas: muestra el vacío que pasa el consumidor.
  "dense-table-vacia": () => (
    <DenseTable<FixtureRow>
      label="Módulos"
      columns={columns}
      rows={[]}
      rowKey={(row) => row.id}
      empty={<EmptyState size="compact" title="Sin módulos configurados" />}
    />
  ),
  // Como StudyBandeja.tsx: un ítem que filtra (onSelect) y un ítem de solo lectura.
  "stat-strip": () => (
    <StatStrip
      label="Vistas de la bandeja"
      items={[
        { key: "pendientes", label: "Pendientes", value: 3, active: true, onSelect: () => undefined },
        { key: "vencidos", label: "Vencidos", value: 5, detail: "esta semana", tone: "warn" },
        { key: "cargando", label: "Ítems", value: "…" },
      ]}
    />
  ),
  // Como StudyClientes.tsx: con inspector lateral.
  "dense-workspace-inspector": () => (
    <DenseWorkspace
      panelId="clients-panel"
      inspector={
        <Inspector label="Detalle del cliente" title="Cliente sintético A">
          Ficha
        </Inspector>
      }
    >
      <p>Tabla de clientes</p>
    </DenseWorkspace>
  ),
  // Como StudyAdministracionPlataforma.tsx: sin inspector.
  "dense-workspace-sin-inspector": () => (
    <DenseWorkspace panelId="platform-modules-panel">
      <p>Módulos</p>
    </DenseWorkspace>
  ),
  // Como StudyOnboardingFiscal.tsx: vacío compacto con acción.
  "empty-compact-accion": () => (
    <EmptyState
      size="compact"
      title="Sin regímenes adheridos"
      description="Registrá el régimen fiscal que aplica al contribuyente."
      action={
        <Button type="button" size="sm" variant="secondary">
          Registrar inscripción
        </Button>
      }
    />
  ),
  // Vacío por filtros, tamaño por defecto.
  "empty-regular-sin-coincidencias": () => (
    <EmptyState kind="no-results" title="Ningún cliente coincide" description="Ajustá la búsqueda." />
  ),
  // Vacío sin ninguna prop opcional.
  "empty-por-defecto": () => <EmptyState title="Todavía no hay clientes" />,
};
