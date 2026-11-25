import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button, EmptyState, Notice, Table, useNotify, SearchSelect } from "@contable/design-system";
import { api, downloadFile } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { StatusBadge } from "../ui/StatusBadge";
import { DenseHeader, DensePage, DenseSection, useDensity } from "../ui/Dense";
import { mensajeDeErrorDeLiquidacion } from "./liquidaciones/errores";
import { fiscalTaxPeriodSelectionKey, writeFiscalTaxPeriodSelection } from "./legajo/periodoFiscal";
import "./study.css";
import { formatearPeriodo } from "../lib/formatoFechas";

interface TaxSettlement {
  id: string;
  version: number;
  status: string;
  cutoff: string;
  totals: Record<string, string> | null;
  period: { id: string; label: string | null; startDate: string; endDate: string };
  regime: {
    code: string;
    name: string;
    isActive: boolean;
    taxType: { code: string; name: string; isActive: boolean };
    jurisdiction: { name: string; isActive: boolean };
  };
}

type ArtifactFormat = "csv" | "pdf";
interface TaxExportArtifact {
  id: string;
  format: string;
}

function formatMoney(value: string | undefined | null): string {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(num);
}

const mesDe = (row: TaxSettlement) => formatearPeriodo(row.period.startDate, row.period.endDate);

export function StudyLiquidaciones() {
  const [density] = useDensity();
  const { firmId, clientId, capabilities } = useClientContext();
  const navigate = useNavigate();
  const notify = useNotify();
  const [filtroImpuesto, setFiltroImpuesto] = useState("");
  const [filtroMes, setFiltroMes] = useState("");

  // Historial de solo lectura: todas las liquidaciones del cliente, sin depender de un período elegido en otra pantalla.
  const listQuery = useQuery({
    queryKey: ["tax-settlements", firmId, clientId, "todas"],
    queryFn: () => api.get<TaxSettlement[]>(`/firms/${firmId}/clients/${clientId}/tax-settlements?limit=200`),
    enabled: Boolean(firmId && clientId),
  });

  const failed = (error: unknown) =>
    notify.error(mensajeDeErrorDeLiquidacion(error, "No se pudo completar la acción sobre la liquidación."));
  // El papel de trabajo se genera una vez por versión y formato: si ya existe, se descarga el guardado.
  const downloadArtifact = async (id: string, format: ArtifactFormat) => {
    const artifactsPath = `/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/artifacts`;
    const existing = (await api.get<TaxExportArtifact[]>(artifactsPath)).find((artifact) => artifact.format === format);
    const artifactId =
      existing?.id ?? (await api.post<{ artifact: TaxExportArtifact }>(artifactsPath, { format })).artifact.id;
    await downloadFile(`${artifactsPath}/${artifactId}/download`);
  };
  const artifactMutation = useMutation({
    mutationFn: ({ id, format }: { id: string; format: ArtifactFormat }) => downloadArtifact(id, format),
    onSuccess: (_, variables) => notify.success(`Se descargó el papel de trabajo en ${variables.format.toUpperCase()}.`),
    onError: failed,
  });
  const artifactIsBusy = (id: string, format: ArtifactFormat) =>
    artifactMutation.isPending && artifactMutation.variables?.id === id && artifactMutation.variables.format === format;

  const all = useMemo(
    () =>
      [...(listQuery.data ?? [])].sort(
        (a, b) => b.period.startDate.localeCompare(a.period.startDate) || b.version - a.version,
      ),
    [listQuery.data],
  );
  const opcionesImpuesto = useMemo(
    () =>
      [...new Map(all.map((row) => [row.regime.taxType.code, row.regime.taxType.name])).entries()].map(
        ([value, label]) => ({ value, label }),
      ),
    [all],
  );
  const opcionesMes = useMemo(
    () =>
      [...new Map(all.map((row) => [row.period.startDate, mesDe(row)])).entries()].map(([value, label]) => ({
        value,
        label,
      })),
    [all],
  );
  const data = all.filter(
    (row) =>
      (!filtroImpuesto || row.regime.taxType.code === filtroImpuesto) &&
      (!filtroMes || row.period.startDate === filtroMes),
  );

  // El Legajo toma el mes de la selección guardada: se deja el de la liquidación y se abre.
  const abrirEnLegajo = (row: TaxSettlement) => {
    if (firmId && clientId) writeFiscalTaxPeriodSelection(fiscalTaxPeriodSelectionKey(firmId, clientId), row.period.id);
    navigate("/expediente-mensual");
  };

  if (!firmId || !clientId) {
    return (
      <EmptyState
        title="Elegí un cliente"
        description="La cartera fiscal se organiza dentro de un cliente explícito."
      />
    );
  }

  const puedeExportar = capabilities.has("tax.settlements.export");
  return (
    <DensePage density={density} flow>
      <DenseHeader
        title="Liquidaciones"
        description="Historial de todas las liquidaciones del cliente, con su versión y estado. Para calcular o rectificar, abrí el Legajo."
        actions={
          <Button variant="secondary" onClick={() => navigate("/expediente-mensual")}>
            Abrir en el Legajo
          </Button>
        }
      />

      <DenseSection
        id="settlements-list"
        title="Liquidaciones registradas"
        count={listQuery.data ? data.length : undefined}
        surface="integrated"
        actions={
          all.length > 1 ? (
            <>
              <SearchSelect
                hideLabel
                label="Filtrar por mes"
                className="dense-select"
                value={filtroMes}
                onChange={setFiltroMes}
                placeholder="Mes: todos"
                options={opcionesMes}
              />
              <SearchSelect
                hideLabel
                label="Filtrar por impuesto"
                className="dense-select"
                value={filtroImpuesto}
                onChange={setFiltroImpuesto}
                placeholder="Impuesto: todos"
                options={opcionesImpuesto}
              />
            </>
          ) : null
        }
      >
        {listQuery.isLoading ? (
          <div className="study-state" role="status">
            Cargando liquidaciones…
          </div>
        ) : listQuery.isError ? (
          <Notice
            tone="error"
            title="No se pudieron cargar las liquidaciones"
            action={
              <Button variant="secondary" onClick={() => void listQuery.refetch()}>
                Reintentar
              </Button>
            }
          >
            Reintentá en unos minutos para volver a cargar la cartera.
          </Notice>
        ) : all.length === 0 ? (
          <EmptyState
            title="Todavía no hay liquidaciones"
            description="Las liquidaciones se calculan en el Legajo y aparecen acá cuando existen."
            action={
              <Button variant="secondary" onClick={() => navigate("/expediente-mensual")}>
                Abrir en el Legajo
              </Button>
            }
          />
        ) : (
          <Table<TaxSettlement>
            columns={[
              { key: "month", header: "Mes", render: (row) => mesDe(row) },
              {
                key: "tax",
                header: "Impuesto",
                render: (row) =>
                  `${row.regime.taxType.name}${!row.regime.taxType.isActive ? " (oculto)" : ""} · ${row.regime.name}${!row.regime.isActive ? " (oculto)" : ""}`,
              },
              {
                key: "status",
                header: "Estado",
                render: (row) => (
                  <>
                    <StatusBadge status={row.status} /> <small>v{row.version}</small>
                  </>
                ),
              },
              {
                key: "total",
                header: "Total",
                align: "right",
                render: (row) => formatMoney(row.totals?.["TOTAL_A_INGRESAR"] ?? row.totals?.totalDue),
              },
              {
                key: "actions",
                header: "Acciones",
                render: (row) => (
                  <span className="study-table__actions">
                    <Button size="sm" variant="ghost" onClick={() => abrirEnLegajo(row)}>
                      Abrir en el Legajo
                    </Button>
                    {row.status === "FINALIZED" && puedeExportar ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={artifactIsBusy(row.id, "pdf")}
                          loadingLabel="Generando…"
                          disabled={artifactMutation.isPending}
                          onClick={() => artifactMutation.mutate({ id: row.id, format: "pdf" })}
                        >
                          Descargar PDF
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={artifactIsBusy(row.id, "csv")}
                          loadingLabel="Generando…"
                          disabled={artifactMutation.isPending}
                          onClick={() => artifactMutation.mutate({ id: row.id, format: "csv" })}
                        >
                          Descargar CSV
                        </Button>
                      </>
                    ) : null}
                  </span>
                ),
              },
            ]}
            rows={data}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                size="compact"
                kind="no-data"
                title="Ninguna liquidación coincide con el filtro"
                description="Cambiá el mes o el impuesto para ver más."
              />
            }
          />
        )}
      </DenseSection>
    </DensePage>
  );
}
