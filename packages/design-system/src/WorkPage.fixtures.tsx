/*
 * Ficha de ejemplo de la página de trabajo. Datos inventados y rotulados como sintéticos.
 * La usan las pruebas; no es una pantalla de la aplicación.
 */
import { useState } from "react";
import { BarSelect } from "./BarSelect.js";
import { Button } from "./Button.js";
import { Menu, type MenuActionItem, type MenuSelectOption } from "./Menu.js";
import { StatusBadge } from "./StatusBadge.js";
import { Table, type TableColumn } from "./Table.js";
import { WorkBar } from "./WorkBar.js";
import { WorkPage } from "./WorkPage.js";

interface FilaEjemplo {
  id: string;
  concepto: string;
  importe: string;
  estado: string;
}

const filas: FilaEjemplo[] = [
  { id: "f-1", concepto: "Concepto sintético A", importe: "1.000,00", estado: "Listo" },
  { id: "f-2", concepto: "Concepto sintético B", importe: "250,50", estado: "Pendiente" },
];

const columnas: TableColumn<FilaEjemplo>[] = [
  { key: "concepto", header: "Concepto", render: (fila) => fila.concepto },
  { key: "importe", header: "Importe", align: "right", render: (fila) => fila.importe },
  { key: "estado", header: "Estado", render: (fila) => fila.estado },
];

const periodos = [
  { value: "2026-01", label: "Período sintético 01/2026" },
  { value: "2026-02", label: "Período sintético 02/2026" },
];

const revisiones: MenuSelectOption[] = [
  {
    key: "r2",
    label: "Revisión 2",
    status: <StatusBadge status="READY" />,
    secondary: "la más reciente",
  },
  { key: "r1", label: "Revisión 1", secondary: "reemplazada · solo lectura" },
];

const acciones: MenuActionItem[] = [
  {
    key: "exportar",
    label: "Exportar libros",
    description: "Elige libro, formato y columnas.",
    icon: "download",
    onSelect: () => undefined,
  },
  {
    key: "nuevo",
    label: "Nuevo legajo",
    description: "Crea el legajo del período elegido.",
    icon: "plus",
    disabled: true,
    disabledReason: "Ya existe un legajo en este período.",
    onSelect: () => undefined,
  },
];

/** Página de trabajo de ejemplo: barra completa con datos inventados. */
export function WorkPageFixture() {
  const [periodo, setPeriodo] = useState(periodos[0]?.value ?? "");
  const [revision, setRevision] = useState<string | null>("r2");

  return (
    <WorkPage
      bar={
        <WorkBar
          label="Legajo sintético: período, revisión, etapas y acciones"
          context={
            <>
              <BarSelect
                label="Período fiscal"
                options={periodos}
                value={periodo}
                onChange={(evento) => setPeriodo(evento.target.value)}
              />
              <Menu
                kind="actions"
                label="Acciones del período"
                trigger="Acciones del período"
                items={acciones}
              />
              <Menu
                kind="select"
                label="Revisión"
                trigger={`Revisión ${revision === "r1" ? "1" : "2"}`}
                options={revisiones}
                value={revision}
                onChange={setRevision}
              />
              <StatusBadge status="READY" />
            </>
          }
          action={
            <Button type="button" variant="primary">
              Calcular liquidación
            </Button>
          }
          note="Revisión 1 en solo lectura: fue reemplazada por la revisión 2."
          reason="Faltan 2 controles bloqueantes."
          sections={
            <>
              <Button type="button" variant="ghost" size="row" aria-current="true">
                Fuentes
              </Button>
              <Button type="button" variant="ghost" size="row">
                Clasificación
              </Button>
            </>
          }
          sectionActions={
            <Button type="button" variant="secondary" size="row">
              Actualizar
            </Button>
          }
        />
      }
    >
      <Table columns={columnas} rows={filas} rowKey={(fila) => fila.id} />
    </WorkPage>
  );
}
