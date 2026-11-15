import type { Dispatch, SetStateAction } from "react";
import { Button, Table } from "@contable/design-system";
import { shortDate } from "./utilidades";
import type { RuleVersion } from "./tipos";

interface TabVencimientosProps {
  editable: boolean;
  showDueDateForm: boolean;
  setShowDueDateForm: Dispatch<SetStateAction<boolean>>;
  selectedVersion: RuleVersion;
}

export function TabVencimientos({
  editable,
  showDueDateForm,
  setShowDueDateForm,
  selectedVersion,
}: TabVencimientosProps) {
  return (
    <>
              <section className="study-panel" aria-labelledby="rule-due-dates-title">
                <div className="study-panel__heading">
                  <div>
                    <h2 id="rule-due-dates-title">Vencimientos</h2>
                    <p>Reglas usadas para calcular fechas de presentación y pago.</p>
                  </div>
                  {editable ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowDueDateForm((visible) => !visible)}
                    >
                      {showDueDateForm ? "Cancelar" : "Agregar vencimiento"}
                    </Button>
                  ) : null}
                </div>
                <Table<RuleVersion["dueDateRules"][number]>
                  rows={selectedVersion.dueDateRules}
                  rowKey={(row) => row.id}
                  empty="No hay vencimientos cargados para esta versión."
                  columns={[
                    {
                      key: "frequency",
                      header: "Frecuencia",
                      render: (row) => row.frequency ?? "—",
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
              </section>
    </>
  );
}
