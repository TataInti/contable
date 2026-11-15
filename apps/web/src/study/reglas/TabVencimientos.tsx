import type { Dispatch, SetStateAction } from "react";
import { Button, Table } from "@contable/design-system";
import { DenseSection } from "../../ui/Dense";
import { etiquetaFrecuencia } from "./frecuencias";
import { shortDate } from "./utilidades";
import type { RuleVersion } from "./tipos";

interface TabVencimientosProps {
  editable: boolean;
  showDueDateForm: boolean;
  setShowDueDateForm: Dispatch<SetStateAction<boolean>>;
  selectedVersion: RuleVersion;
}

// Lectura sin caja (D-R3-7): la sección va sobre el lienzo; el alta queda como acción secundaria.
export function TabVencimientos({
  editable,
  showDueDateForm,
  setShowDueDateForm,
  selectedVersion,
}: TabVencimientosProps) {
  return (
    <DenseSection
      id="rule-due-dates"
      title="Vencimientos"
      description="El calendario publicado del organismo tiene prioridad. Estas reglas calculan las fechas de presentación y pago cuando no hay calendario publicado."
      actions={
        editable ? (
          <Button size="sm" variant="secondary" onClick={() => setShowDueDateForm((visible) => !visible)}>
            {showDueDateForm ? "Cancelar" : "Agregar vencimiento"}
          </Button>
        ) : undefined
      }
    >
      <Table<RuleVersion["dueDateRules"][number]>
        rows={selectedVersion.dueDateRules}
        rowKey={(row) => row.id}
        empty="No hay vencimientos cargados para esta versión."
        columns={[
          {
            key: "frequency",
            header: "Frecuencia",
            render: (row) => etiquetaFrecuencia(row.frequency),
          },
          { key: "dueDay", header: "Día", render: (row) => String(row.dueDay) },
          {
            key: "cuitEnding",
            header: "CUIT",
            render: (row) => row.cuitEnding ?? "Todas",
          },
          {
            key: "validFrom",
            header: "Vigencia",
            render: (row) => `${shortDate(row.validFrom)} — ${shortDate(row.validTo)}`,
          },
        ]}
      />
    </DenseSection>
  );
}
