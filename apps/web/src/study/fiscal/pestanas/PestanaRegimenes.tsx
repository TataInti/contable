import type { UseQueryResult } from "@tanstack/react-query";
import { Button, EmptyState, Table } from "@contable/design-system";
import { formatearFecha } from "../../../lib/formatoFechas";
import { StatusBadge } from "../../../ui/StatusBadge";
import type { ConfirmApi, FiscalStep, MutacionConValor, TaxRegistration } from "../utilidades";
import { nombreRegimen } from "../etiquetaRegimen";
import { textoCategoriaTem, textoFaltaCategoriaTem, type FilaCategoriaTem } from "../categoriaTem";
import { textoCategoriaMonotributo, type FilaCategoriaMonotributo } from "../monotributo";

type Props = {
  canWrite: boolean;
  openStepForm: (paso: FiscalStep) => void;
  registrationsQuery: UseQueryResult<TaxRegistration[]>;
  cancelRegistration: MutacionConValor;
  /** Abre el cajón que corrige el «Desde» de la inscripción. */
  corregirFecha: (registration: TaxRegistration) => void;
  confirm: ConfirmApi;
  /** Categoría anual del TEM: la fila del régimen que la usa muestra la elegida o lo que falta. */
  categoriaTem?: FilaCategoriaTem;
  /** Cuota fija mensual del Monotributo (corte 3F): la fila del régimen nacional muestra la categoría o lo que falta. */
  categoriaMonotributo?: FilaCategoriaMonotributo;
};

export function PestanaRegimenes({ canWrite, openStepForm, registrationsQuery, cancelRegistration, corregirFecha, confirm, categoriaTem, categoriaMonotributo }: Props) {
  const usaCategoriaTem = (row: TaxRegistration) => Boolean(categoriaTem && row.status === "ACTIVE" && categoriaTem.regimeIds.includes(row.regime.id));
  const usaMonotributo = (row: TaxRegistration) => Boolean(categoriaMonotributo && row.status === "ACTIVE" && categoriaMonotributo.regimeIds.includes(row.regime.id));
  return (
    <section className="fiscal-section" aria-labelledby="fiscal-regimes-title">
      <div className="fiscal-client-overview__heading"><h3 id="fiscal-regimes-title">Regímenes adheridos</h3>{canWrite ? <Button size="sm" variant="secondary" onClick={() => openStepForm("inscripcion")}>{(registrationsQuery.data?.length ?? 0) > 0 ? "Agregar otra inscripción" : "Agregar"}</Button> : null}</div>
      {registrationsQuery.isLoading ? <p className="muted-copy">Cargando adhesiones…</p> : (registrationsQuery.data?.length ?? 0) === 0 ? <EmptyState size="compact" title="Sin regímenes adheridos" description="Registrá el régimen fiscal que aplica al contribuyente." action={canWrite ? <Button size="sm" variant="secondary" onClick={() => openStepForm("inscripcion")}>Registrar inscripción</Button> : undefined} /> : <Table<TaxRegistration> rows={registrationsQuery.data ?? []} rowKey={(row) => row.id} columns={[
        { key: "regime", header: "Régimen", render: (row: TaxRegistration) => <><strong>{nombreRegimen(row.regime)}{!row.regime.isActive ? " (oculto)" : ""}</strong>{usaCategoriaTem(row) && categoriaTem && !categoriaTem.loading ? <div className="fiscal-regime-category">{categoriaTem.category && categoriaTem.label ? <span className="muted-copy">{textoCategoriaTem(categoriaTem.year, categoriaTem.label)}</span> : <StatusBadge status="MISSING" label={textoFaltaCategoriaTem(categoriaTem.year)} variant="plain" />}</div> : null}{usaMonotributo(row) && categoriaMonotributo ? <div className="fiscal-regime-category">{categoriaMonotributo.categoria ? <span className="muted-copy">{textoCategoriaMonotributo(categoriaMonotributo.categoria)}</span> : <StatusBadge status="MISSING" label="Falta la categoría de monotributo" variant="plain" />}</div> : null}</> },
        { key: "tax", header: "Impuesto", render: (row) => <>{row.regime.taxType.name}{!row.regime.taxType.isActive ? " (oculto)" : ""}</> },
        { key: "jurisdiction", header: "Jurisdicción", render: (row) => <>{row.regime.jurisdiction.name}{!row.regime.jurisdiction.isActive ? " (oculto)" : ""}</> },
        { key: "from", header: "Desde", render: (row) => <span className="tabular-copy">{formatearFecha(row.validFrom)}</span> },
        { key: "status", header: "Estado", render: (row) => <StatusBadge status={row.status} /> },
        { key: "actions", header: "", align: "right", render: (row) => canWrite && row.status === "ACTIVE" ? <div className="table-actions">{usaCategoriaTem(row) && categoriaTem ? <Button size="sm" variant="ghost" onClick={categoriaTem.abrir}>{categoriaTem.category ? "Cambiar categoría" : "Elegir categoría"}</Button> : null}{usaMonotributo(row) && categoriaMonotributo ? <Button size="sm" variant="ghost" onClick={categoriaMonotributo.abrir}>{categoriaMonotributo.categoria ? "Cambiar categoría" : "Elegir categoría"}</Button> : null}<Button size="sm" variant="ghost" onClick={() => corregirFecha(row)}>Corregir fecha</Button><Button size="sm" variant="ghost" loading={cancelRegistration.isPending} onClick={() => confirm.ask({ title: `¿Dar de baja ${row.regime.name}?`, description: "La adhesión al régimen quedará cancelada desde hoy. Esta acción queda registrada en la auditoría.", confirmLabel: "Dar de baja", tone: "danger", onConfirm: () => cancelRegistration.mutate(row.id) })}>Dar de baja</Button></div> : null },
      ]} />}
    </section>
  );
}
