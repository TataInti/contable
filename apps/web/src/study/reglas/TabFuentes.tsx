import type { Dispatch, SetStateAction } from "react";
import { Button, Table } from "@contable/design-system";
import { DenseSection } from "../../ui/Dense";
import { shortDate } from "./utilidades";
import type { RuleVersion } from "./tipos";

interface TabFuentesProps {
  editable: boolean;
  showSourceForm: boolean;
  setShowSourceForm: Dispatch<SetStateAction<boolean>>;
  selectedVersion: RuleVersion;
}

// Lectura sin caja (D-R3-7): la sección va sobre el lienzo; el alta queda como acción secundaria.
export function TabFuentes({
  editable,
  showSourceForm,
  setShowSourceForm,
  selectedVersion,
}: TabFuentesProps) {
  return (
    <DenseSection
      id="rule-sources"
      title="Fuentes normativas"
      description="Resoluciones, padrones o normas que respaldan esta versión."
      actions={
        editable ? (
          <Button size="sm" variant="secondary" onClick={() => setShowSourceForm((visible) => !visible)}>
            {showSourceForm ? "Cancelar" : "Agregar fuente"}
          </Button>
        ) : undefined
      }
    >
      <Table<RuleVersion["sources"][number]>
        rows={selectedVersion.sources}
        rowKey={(row) => row.id}
        empty="No hay fuentes normativas asociadas a esta versión."
        columns={[
          { key: "title", header: "Fuente", render: (row) => row.title },
          {
            key: "reference",
            header: "Referencia",
            render: (row) => row.reference ?? "—",
          },
          {
            key: "consultedAt",
            header: "Consultada",
            render: (row) => shortDate(row.consultedAt),
          },
        ]}
      />
    </DenseSection>
  );
}
