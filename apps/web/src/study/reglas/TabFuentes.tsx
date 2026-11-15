import type { Dispatch, SetStateAction } from "react";
import { Button, Table } from "@contable/design-system";
import { shortDate } from "./utilidades";
import type { RuleVersion } from "./tipos";

interface TabFuentesProps {
  editable: boolean;
  showSourceForm: boolean;
  setShowSourceForm: Dispatch<SetStateAction<boolean>>;
  selectedVersion: RuleVersion;
}

export function TabFuentes({
  editable,
  showSourceForm,
  setShowSourceForm,
  selectedVersion,
}: TabFuentesProps) {
  return (
    <>
              <section className="study-panel" aria-labelledby="rule-sources-title">
                <div className="study-panel__heading">
                  <div>
                    <h2 id="rule-sources-title">Fuentes normativas</h2>
                    <p>Resoluciones, padrones o normas que respaldan esta versión.</p>
                  </div>
                  {editable ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowSourceForm((visible) => !visible)}
                    >
                      {showSourceForm ? "Cancelar" : "Agregar fuente"}
                    </Button>
                  ) : null}
                </div>
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
              </section>
    </>
  );
}
