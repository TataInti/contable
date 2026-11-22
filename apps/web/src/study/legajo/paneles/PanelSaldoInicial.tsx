import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, MoneyField, SearchSelect } from "@contable/design-system";
import { api } from "../../../lib/api";
import { formatearPeriodo } from "../../../lib/formatoFechas";
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
          <SearchSelect
            id="opening-tax-type"
            label="Impuesto"
            hideLabel
            className="ds-field__input"
            value={opening.taxTypeId}
            onChange={(value) =>
              setOpening((current) => ({
                ...current,
                taxTypeId: value,
                taxPeriodId: "",
                regimeId: "",
                jurisdictionId: "",
                kind:
                  value && tiposImpuesto?.find((type) => type.id === value)?.code === "IVA" ? "IVA_LIBRE" : "SALDO_A_FAVOR",
              }))
            }
            required
            placeholder="Seleccioná…"
            options={(tiposImpuesto ?? []).filter((type) => type.isActive).map((type) => ({ value: type.id, label: type.name }))}
          />
        </div>
        <div className="ds-field">
          <label className="ds-field__label" htmlFor="opening-tax-period">
            Período fiscal
          </label>
          <SearchSelect
            id="opening-tax-period"
            label="Período fiscal"
            hideLabel
            className="ds-field__input"
            value={opening.taxPeriodId}
            onChange={(value) => setOpening((current) => ({ ...current, taxPeriodId: value }))}
            required
            disabled={!opening.taxTypeId}
            placeholder="Seleccioná…"
            options={openingTaxPeriods.map((taxPeriod) => ({
              value: taxPeriod.id,
              label: taxPeriod.label ?? formatearPeriodo(taxPeriod.startDate, taxPeriod.endDate),
            }))}
          />
        </div>
        <div className="ds-field">
          <label className="ds-field__label" htmlFor="opening-regime">
            Régimen
          </label>
          <SearchSelect
            id="opening-regime"
            label="Régimen"
            hideLabel
            className="ds-field__input"
            value={opening.regimeId}
            onChange={(value) => {
              const regime = openingRegimes.find((item) => item.id === value);
              setOpening((current) => ({
                ...current,
                regimeId: value,
                jurisdictionId: regime?.jurisdictionId ?? "",
              }));
            }}
            placeholder="Sin régimen específico"
            options={openingRegimes.map((regime) => ({ value: regime.id, label: `${regime.name} · ${regime.jurisdiction.name}` }))}
          />
        </div>
        <div className="ds-field">
          <label className="ds-field__label" htmlFor="opening-kind">
            Naturaleza
          </label>
          <SearchSelect
            id="opening-kind"
            label="Naturaleza"
            hideLabel
            className="ds-field__input"
            value={opening.kind}
            onChange={(value) => setOpening((current) => ({ ...current, kind: value }))}
            allowEmpty={false}
            options={[
              { value: "SALDO_A_FAVOR", label: "Saldo a favor" },
              ...(tiposImpuesto?.find((type) => type.id === opening.taxTypeId)?.code === "IVA"
                ? [
                  { value: "IVA_TECNICO", label: "IVA · saldo técnico" },
                  { value: "IVA_LIBRE", label: "IVA · libre disponibilidad" },
                ]
                : []),
            ]}
          />
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
          <SearchSelect
            id="opening-evidence"
            label="Documento de respaldo"
            hideLabel
            className="ds-field__input"
            value={opening.evidenceDocumentId}
            onChange={(value) => setOpening((current) => ({ ...current, evidenceDocumentId: value }))}
            placeholder="Sin documento (carga manual)"
            options={(documentos ?? []).map((document) => ({
              value: document.id,
              label: document.fileVersions?.[0]?.originalName ?? document.category ?? "Documento",
            }))}
          />
        </div>
        <WorkpaperActionError error={openingMutation.error} />
      </form>
    </ActionDrawer>
  );
}
