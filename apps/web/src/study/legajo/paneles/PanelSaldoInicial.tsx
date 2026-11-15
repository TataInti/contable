import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, MoneyField } from "@contable/design-system";
import { api } from "../../../lib/api";
import { formatearRango } from "../../../lib/formatoFechas";
import { ActionDrawer, ActionDrawerFooter } from "../../../ui/ActionDrawer";
import type { EvidenceDocument, FiscalTaxPeriod, TaxRegime, TaxType } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";

interface PanelSaldoInicialProps {
  abierto: boolean;
  onCerrar: () => void;
  firmId: string;
  clientId: string;
  tiposImpuesto: TaxType[] | undefined;
  regimenes: TaxRegime[] | undefined;
  periodosFiscales: FiscalTaxPeriod[] | undefined;
  documentos: EvidenceDocument[] | undefined;
}

export function PanelSaldoInicial({
  abierto,
  onCerrar,
  firmId,
  clientId,
  tiposImpuesto,
  regimenes,
  periodosFiscales,
  documentos,
}: PanelSaldoInicialProps) {
  const queryClient = useQueryClient();
  const [opening, setOpening] = useState({
    taxTypeId: "",
    taxPeriodId: "",
    regimeId: "",
    jurisdictionId: "",
    kind: "SALDO_A_FAVOR",
    amount: "",
    evidenceDocumentId: "",
  });
  const openingMutation = useMutation({
    mutationFn: () =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-credit-ledger/opening`, {
        taxTypeId: opening.taxTypeId,
        ...(opening.regimeId ? { regimeId: opening.regimeId } : {}),
        ...(opening.jurisdictionId ? { jurisdictionId: opening.jurisdictionId } : {}),
        periodId: opening.taxPeriodId,
        kind: opening.kind,
        amount: opening.amount,
        ...(opening.evidenceDocumentId ? { evidenceDocumentId: opening.evidenceDocumentId } : {}),
      }),
    onSuccess: () => {
      onCerrar();
      setOpening({
        taxTypeId: "",
        taxPeriodId: "",
        regimeId: "",
        jurisdictionId: "",
        kind: "SALDO_A_FAVOR",
        amount: "",
        evidenceDocumentId: "",
      });
      void queryClient.invalidateQueries({ queryKey: ["tax-credit-ledger", firmId, clientId] });
      void queryClient.invalidateQueries({
        queryKey: ["tax-position", firmId, clientId],
      });
    },
  });
  const openingRegimes = (regimenes ?? []).filter(
    (regime) => regime.isActive && (!opening.taxTypeId || regime.taxTypeId === opening.taxTypeId),
  );
  const openingTaxPeriods = (periodosFiscales ?? []).filter(
    (taxPeriod) =>
      taxPeriod.taxType.isActive &&
      (!opening.taxTypeId || taxPeriod.taxTypeId === opening.taxTypeId),
  );
  const motivoRegistrar = !opening.taxTypeId
    ? "Elegí el impuesto."
    : !opening.taxPeriodId
      ? "Elegí el período fiscal."
      : !opening.amount
        ? "Indicá el importe del saldo."
        : null;
  return (
    <ActionDrawer
      isOpen={abierto}
      onClose={onCerrar}
      title="Cargar saldo inicial"
      description="Registrá un saldo a favor o arrastre. Podés adjuntar un respaldo documental o cargarlo manualmente; en ambos casos queda registrado el usuario que lo hizo."
      size="wide"
      footer={
        <ActionDrawerFooter
          primary={
            <Button
              type="submit"
              form="legajo-saldo-inicial"
              loading={openingMutation.isPending}
              disabled={motivoRegistrar !== null}
            >
              Registrar saldo
            </Button>
          }
          hint={motivoRegistrar}
          onCancel={onCerrar}
        />
      }
    >
      <form
        id="legajo-saldo-inicial"
        className="study-form"
        onSubmit={(event) => {
          event.preventDefault();
          openingMutation.mutate();
        }}
      >
        <div className="ds-field">
          <label className="ds-field__label" htmlFor="opening-tax-type">
            Impuesto
          </label>
          <select
            id="opening-tax-type"
            className="ds-field__input"
            value={opening.taxTypeId}
            onChange={(event) =>
              setOpening((value) => ({
                ...value,
                taxTypeId: event.target.value,
                taxPeriodId: "",
                regimeId: "",
                jurisdictionId: "",
                kind:
                  event.target.value &&
                  tiposImpuesto?.find((type) => type.id === event.target.value)?.code === "IVA"
                    ? "IVA_LIBRE"
                    : "SALDO_A_FAVOR",
              }))
            }
            required
          >
            <option value="">Seleccioná…</option>
            {(tiposImpuesto ?? [])
              .filter((type) => type.isActive)
              .map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
          </select>
        </div>
        <div className="ds-field">
          <label className="ds-field__label" htmlFor="opening-tax-period">
            Período fiscal
          </label>
          <select
            id="opening-tax-period"
            className="ds-field__input"
            value={opening.taxPeriodId}
            onChange={(event) =>
              setOpening((value) => ({ ...value, taxPeriodId: event.target.value }))
            }
            required
            disabled={!opening.taxTypeId}
          >
            <option value="">Seleccioná…</option>
            {openingTaxPeriods.map((taxPeriod) => (
              <option key={taxPeriod.id} value={taxPeriod.id}>
                {taxPeriod.label ??
                  formatearRango(taxPeriod.startDate, taxPeriod.endDate)}
              </option>
            ))}
          </select>
        </div>
        <div className="ds-field">
          <label className="ds-field__label" htmlFor="opening-regime">
            Régimen
          </label>
          <select
            id="opening-regime"
            className="ds-field__input"
            value={opening.regimeId}
            onChange={(event) => {
              const regime = openingRegimes.find((item) => item.id === event.target.value);
              setOpening((value) => ({
                ...value,
                regimeId: event.target.value,
                jurisdictionId: regime?.jurisdictionId ?? "",
              }));
            }}
          >
            <option value="">Sin régimen específico</option>
            {openingRegimes.map((regime) => (
              <option key={regime.id} value={regime.id}>
                {regime.name} · {regime.jurisdiction.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ds-field">
          <label className="ds-field__label" htmlFor="opening-kind">
            Naturaleza
          </label>
          <select
            id="opening-kind"
            className="ds-field__input"
            value={opening.kind}
            onChange={(event) => setOpening((value) => ({ ...value, kind: event.target.value }))}
          >
            <option value="SALDO_A_FAVOR">Saldo a favor</option>
            {tiposImpuesto?.find((type) => type.id === opening.taxTypeId)?.code === "IVA" ? (
              <>
                <option value="IVA_TECNICO">IVA · saldo técnico</option>
                <option value="IVA_LIBRE">IVA · libre disponibilidad</option>
              </>
            ) : null}
          </select>
        </div>
        <MoneyField
          label="Importe"
          id="opening-amount"
          value={opening.amount}
          onChange={(value) => setOpening((state) => ({ ...state, amount: value }))}
          required
        />
        <div className="ds-field">
          <label className="ds-field__label" htmlFor="opening-evidence">
            Documento de respaldo
          </label>
          <select
            id="opening-evidence"
            className="ds-field__input"
            value={opening.evidenceDocumentId}
            onChange={(event) =>
              setOpening((value) => ({ ...value, evidenceDocumentId: event.target.value }))
            }
          >
            <option value="">Sin documento (carga manual)</option>
            {documentos?.map((document) => (
              <option key={document.id} value={document.id}>
                {document.fileVersions?.[0]?.originalName ?? document.category ?? "Documento"}
              </option>
            ))}
          </select>
        </div>
        <WorkpaperActionError error={openingMutation.error} />
      </form>
    </ActionDrawer>
  );
}
