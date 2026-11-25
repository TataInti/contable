import { useState } from "react";
import { useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  AsyncState,
  Button,
  Field,
  getStatusBadgeMeta,
  MoneyField,
  Notice,
  SearchSelect,
  useNotify,
} from "@contable/design-system";
import {
  FILING_DECLARATION_DOCUMENT_CATEGORY,
  taxFilingCreditDetailReadSchema,
  type TaxFilingDeclarationWarning,
} from "@contable/contracts";
import { api } from "../../../lib/api";
import { ActionDrawer, ActionDrawerFooter } from "../../../ui/ActionDrawer";
import { formatearFecha } from "../../../lib/formatoFechas";
import {
  RECEIPT_ACCEPT,
  uploadFilingReceipt,
  uploadPresentacionDocument,
  waitForReceiptReady,
} from "../../filingReceipt";
import { formatMoney } from "../formato";
import type { EvidenceDocument, TaxPosition } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";

const MENSAJES_DJ = {
  fallo: "La declaración jurada no pasó la validación del archivo. Probá con otro archivo.",
  pendiente:
    "La declaración jurada ya quedó subida pero sigue en validación. Esperá un momento, elegila de la lista y guardála.",
};

const IMPORTES = [
  ["impuestoDeterminado", "Impuesto determinado"],
  ["saldoFavorTecnico", "Saldo a favor técnico"],
  ["saldoLibreDisponibilidad", "Saldo a favor de libre disponibilidad"],
  ["totalAPagar", "Total a pagar"],
] as const;

const MOTIVOS_IMPORTE: Record<string, string> = {
  impuestoDeterminado: "el impuesto determinado",
  saldoFavorTecnico: "el saldo a favor técnico",
  saldoLibreDisponibilidad: "el saldo a favor de libre disponibilidad",
  totalAPagar: "el total a pagar",
};

type CampoDj = (typeof IMPORTES)[number][0];
type FormDj = Record<CampoDj, string> & { documentId: string };

// «1234.5600» → «1234.56».
const sinCeros = (valor?: string | null) =>
  (valor ?? "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

const mismoImporte = (a: string, b: string) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.005;

// Corregir reenvía el detalle guardado: si no llega, la API lo borra.
const detalleGuardado = (valor: unknown) =>
  (taxFilingCreditDetailReadSchema.safeParse(valor).data ?? []).map(
    ({ regimeId, jurisdictionId, ...item }) => ({
      ...item,
      ...(regimeId ? { regimeId } : {}),
      ...(jurisdictionId ? { jurisdictionId } : {}),
    }),
  );

// Importe con dos decimales, como lo muestra y envía el resto de la pantalla.
const dosDecimales = (valor?: string | null) => (valor ? Number(valor).toFixed(2) : "0.00");

/** Importes del cálculo con los que arrancan la presentación y la declaración jurada. */
export function importesDelCalculo(posicion: TaxPosition): Record<CampoDj, string> & { presentado: string } {
  const totales = posicion.settlement?.totals ?? {};
  const totalKey = Object.keys(totales).find((k) => k.startsWith("TOTAL_A_INGRESAR"));
  const total = dosDecimales(totalKey ? totales[totalKey] : posicion.accrued);
  return {
    presentado: total,
    impuestoDeterminado: dosDecimales(totales.IMPUESTO_DETERMINADO ?? posicion.accrued),
    saldoFavorTecnico: dosDecimales(totales.SALDO_TECNICO_AFTER),
    saldoLibreDisponibilidad: dosDecimales(totales.SALDO_LIBRE_AFTER),
    totalAPagar: total,
  };
}

interface PanelImpuestoProps {
  posicion: TaxPosition;
  onCerrar: () => void;
  firmId: string;
  clientId: string;
  documentsQuery: UseQueryResult<EvidenceDocument[], Error>;
  canFile: boolean;
  canPay: boolean;
}

/**
 * Un solo cajón por impuesto en el Cierre: Presentación (acuse), Declaración jurada y Pago.
 * Los importes arrancan con los del cálculo y se marca lo que difiere. La posición llega siempre
 * fresca (el padre la busca por obligación), así que las secciones pasan a «hechas» al guardar.
 */
export function PanelImpuesto({
  posicion,
  onCerrar,
  firmId,
  clientId,
  documentsQuery,
  canFile,
  canPay,
}: PanelImpuestoProps) {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const calculo = importesDelCalculo(posicion);
  const base = `/firms/${firmId}/clients/${clientId}`;
  const impuesto = posicion.regime.taxType.name;

  const [presentacion, setPresentacion] = useState({
    amountFiled: calculo.presentado,
    filedAt: new Date().toISOString().slice(0, 10),
    externalId: "",
    evidenceDocumentId: "",
  });
  const [acuse, setAcuse] = useState<File | null>(null);
  const [dj, setDj] = useState<FormDj>({
    impuestoDeterminado: sinCeros(posicion.impuestoDeterminado) || calculo.impuestoDeterminado,
    saldoFavorTecnico: posicion.hasDeclaration ? sinCeros(posicion.saldoFavorTecnico) : calculo.saldoFavorTecnico,
    saldoLibreDisponibilidad: posicion.hasDeclaration
      ? sinCeros(posicion.saldoLibreDisponibilidad)
      : calculo.saldoLibreDisponibilidad,
    totalAPagar: posicion.hasDeclaration ? sinCeros(posicion.totalAPagar) : calculo.totalAPagar,
    documentId: posicion.declarationDocumentId ?? "",
  });
  const [archivoDj, setArchivoDj] = useState<File | null>(null);
  const [advertencias, setAdvertencias] = useState<TaxFilingDeclarationWarning[] | null>(null);
  const [pago, setPago] = useState({
    amount: dosDecimales(posicion.totalPayable),
    paidAt: new Date().toISOString().slice(0, 10),
    method: "TRANSFERENCIA",
    reference: "",
  });
  const detalle = detalleGuardado(posicion.saldosFavorDetalle);

  const presentada = Boolean(posicion.filingId);
  const conDj = Boolean(posicion.hasDeclaration);
  const pagado = Number(posicion.paid) > 0;
  const aPagar = Number(posicion.totalPayable) > 0;

  const documentos = documentsQuery.data ?? [];
  const acuses = documentos.filter(
    (d) => d.category === "ACUSE" && ["READY", "APPLIED"].includes(d.status),
  );
  const declaraciones = documentos.filter(
    (d) =>
      d.category === FILING_DECLARATION_DOCUMENT_CATEGORY && ["READY", "APPLIED"].includes(d.status),
  );
  const opcionesDj = [
    ...(dj.documentId && !declaraciones.some((d) => d.id === dj.documentId)
      ? [{ id: dj.documentId, label: "Declaración jurada seleccionada" }]
      : []),
    ...declaraciones.map((d) => ({
      id: d.id,
      label: `${d.fileVersions?.[0]?.originalName ?? "Declaración jurada"} · ${getStatusBadgeMeta(d.status).label}`,
    })),
  ];

  // Qué se puede guardar ahora: la presentación (acuse) y/o la declaración jurada.
  const presentacionLista =
    !presentada &&
    Boolean(presentacion.amountFiled && presentacion.filedAt) &&
    Boolean(presentacion.evidenceDocumentId || acuse);
  const djCompleta =
    IMPORTES.every(([campo]) => dj[campo] !== "") && Boolean(dj.documentId || archivoDj);
  const djLista = (presentada || presentacionLista) && djCompleta;
  const faltaImporte = IMPORTES.find(([campo]) => dj[campo] === "");
  const motivo = !posicion.settlement
    ? "Falta la liquidación finalizada del período."
    : !presentada
      ? !presentacion.amountFiled
        ? "Indicá el importe presentado."
        : !presentacion.evidenceDocumentId && !acuse
          ? "Adjuntá el acuse de presentación."
          : null
      : faltaImporte
        ? `Indicá ${MOTIVOS_IMPORTE[faltaImporte[0]]}.`
        : dj.documentId
          ? null
          : documentsQuery.isPending
            ? "Esperá a que carguen los documentos del cliente."
            : documentsQuery.isError
              ? "No pudimos cargar los documentos. Reintentá."
              : archivoDj
                ? null
                : "Adjuntá la declaración jurada.";

  const etiquetaGuardar = !presentada
    ? djCompleta
      ? "Guardar presentación y declaración jurada"
      : "Registrar presentación"
    : conDj
      ? "Guardar corrección"
      : "Guardar declaración jurada";

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ["tax-position", firmId, clientId] });

  const guardarMutation = useMutation({
    mutationFn: async () => {
      let filingId = posicion.filingId ?? null;
      if (presentacionLista) {
        // La constancia es obligatoria: se elige una ya subida o se sube en este mismo paso.
        let evidenceDocumentId = presentacion.evidenceDocumentId;
        if (!evidenceDocumentId && acuse) {
          evidenceDocumentId = await uploadFilingReceipt(base, acuse);
          setPresentacion((f) => ({ ...f, evidenceDocumentId }));
          setAcuse(null);
          await queryClient.invalidateQueries({ queryKey: ["documents", firmId, clientId] });
          await waitForReceiptReady(base, evidenceDocumentId);
        }
        const creada = await api.post<{ id: string }>(
          `${base}/tax-obligations/${posicion.obligationId}/filings`,
          {
            settlementId: posicion.settlement?.id,
            filedAt: presentacion.filedAt,
            amountFiled: presentacion.amountFiled,
            ...(presentacion.externalId.trim() ? { externalId: presentacion.externalId.trim() } : {}),
            evidenceDocumentId,
          },
        );
        filingId = creada.id;
        // Si la declaración jurada se guarda en el mismo paso, un solo aviso: dos apilados tapan el pie del cajón.
        if (!djLista) notify.success("Presentación registrada con su acuse.");
        await invalidar();
      }
      if (!djLista || !filingId) return { warnings: [] as TaxFilingDeclarationWarning[], dj: false };
      let declarationDocumentId = dj.documentId;
      // Si el guardado falla después de subir el archivo, el reintento usa ese mismo documento.
      if (!declarationDocumentId && archivoDj) {
        declarationDocumentId = await uploadPresentacionDocument(
          base,
          archivoDj,
          FILING_DECLARATION_DOCUMENT_CATEGORY,
        );
        setDj((f) => ({ ...f, documentId: declarationDocumentId }));
        setArchivoDj(null);
        await queryClient.invalidateQueries({ queryKey: ["documents", firmId, clientId] });
        await waitForReceiptReady(base, declarationDocumentId, { mensajes: MENSAJES_DJ });
      }
      const { warnings } = await api.patch<{ warnings: TaxFilingDeclarationWarning[] }>(
        `${base}/tax-obligations/${posicion.obligationId}/filings/${filingId}/declaration`,
        {
          declarationDocumentId,
          impuestoDeterminado: dj.impuestoDeterminado,
          saldoFavorTecnico: dj.saldoFavorTecnico,
          saldoLibreDisponibilidad: dj.saldoLibreDisponibilidad,
          totalAPagar: dj.totalAPagar,
          ...(detalle.length > 0 ? { saldosFavorDetalle: detalle } : {}),
        },
      );
      return { warnings, dj: true };
    },
    onSuccess: ({ warnings, dj: guardoDj }) => {
      void invalidar();
      if (!guardoDj) return;
      // Las diferencias informan y no bloquean (D5B-5): se leen sin cerrar el cajón.
      setAdvertencias(warnings.length > 0 ? warnings : null);
      if (warnings.length === 0) {
        notify.success(
          presentacionLista
            ? "Presentación y declaración jurada guardadas."
            : conDj
              ? "Declaración jurada corregida."
              : "Declaración jurada cargada.",
        );
        if (!aPagar || !canPay) onCerrar();
      }
    },
    onError: () => void invalidar(),
  });

  const pagoMutation = useMutation({
    mutationFn: () =>
      api.post(`${base}/tax-obligations/${posicion.obligationId}/payments`, {
        ...(posicion.settlement ? { settlementId: posicion.settlement.id } : {}),
        paidAt: pago.paidAt,
        amount: pago.amount,
        method: pago.method,
        ...(pago.reference.trim() ? { reference: pago.reference.trim() } : {}),
      }),
    onSuccess: () => {
      notify.success("Pago registrado.");
      void invalidar();
      onCerrar();
    },
  });
  const motivoPago = !pago.amount ? "Indicá el importe del pago." : null;

  // Diferencia con el cálculo: se marca el campo y se dice cuánto era.
  const difiere = (campo: CampoDj) =>
    !mismoImporte(dj[campo], calculo[campo]) ? `Difiere del cálculo: ${formatMoney(calculo[campo])}` : undefined;
  const difierePresentado = !mismoImporte(presentacion.amountFiled, calculo.presentado)
    ? `Difiere del cálculo: ${formatMoney(calculo.presentado)}`
    : undefined;

  return (
    <ActionDrawer
      isOpen
      onClose={onCerrar}
      title={impuesto}
      description={`${posicion.regime.jurisdiction.name}. Presentación, declaración jurada y pago en un solo lugar: los importes arrancan con los del cálculo y, si cambiás alguno, se marca la diferencia.`}
      size="wide"
      footer={
        <ActionDrawerFooter
          primary={
            canFile ? (
              <Button
                type="submit"
                form="legajo-cajon-impuesto"
                loading={guardarMutation.isPending}
                loadingLabel="Subiendo y validando"
                disabled={motivo !== null}
              >
                {etiquetaGuardar}
              </Button>
            ) : null
          }
          hint={canFile ? motivo : null}
          onCancel={onCerrar}
          cancelLabel="Cerrar"
        />
      }
    >
      <form
        id="legajo-cajon-impuesto"
        className="study-form study-form--presentacion legajo-cajon-impuesto"
        onSubmit={(event) => {
          event.preventDefault();
          if (motivo === null) guardarMutation.mutate();
        }}
      >
        <section className="legajo-cajon-impuesto__seccion study-form__full" aria-label="Presentación (acuse)">
          <h3>Presentación (acuse)</h3>
          {presentada ? (
            <p role="status">
              Presentada el {formatearFecha(posicion.filedAt, "sin fecha")} · acuse cargado.
            </p>
          ) : !canFile ? (
            <p>Tu perfil no tiene permiso para registrar la presentación.</p>
          ) : (
            <div className="study-form study-form--presentacion">
              <MoneyField
                label="Importe presentado"
                id="tax-filing-amount"
                value={presentacion.amountFiled}
                onChange={(value) => setPresentacion({ ...presentacion, amountFiled: value })}
                hint={difierePresentado}
                required
              />
              <Field
                label="Fecha de presentación"
                id="tax-filing-date"
                type="date"
                value={presentacion.filedAt}
                onChange={(event) => setPresentacion({ ...presentacion, filedAt: event.target.value })}
                required
              />
              {acuses.length > 0 ? (
                <div className="ds-field study-form__full">
                  <label className="ds-field__label" htmlFor="tax-filing-evidence">
                    Acuse de presentación
                  </label>
                  <SearchSelect
                    id="tax-filing-evidence"
                    label="Acuse de presentación"
                    hideLabel
                    className="ds-field__input"
                    value={presentacion.evidenceDocumentId}
                    onChange={(value) => setPresentacion({ ...presentacion, evidenceDocumentId: value })}
                    placeholder="Elegir uno ya subido (o adjuntá el archivo abajo)"
                    options={acuses.map((document) => ({
                      value: document.id,
                      label: `${document.fileVersions?.[0]?.originalName ?? "Acuse"} · ${getStatusBadgeMeta(document.status).label}`,
                    }))}
                  />
                </div>
              ) : null}
              {!presentacion.evidenceDocumentId ? (
                <div className="study-form__full">
                  <Field
                    label="Archivo del acuse"
                    id="tax-filing-receipt"
                    type="file"
                    accept={RECEIPT_ACCEPT}
                    hint="PDF o imagen: el comprobante que emite el organismo."
                    required
                    onChange={(event) => setAcuse(event.target.files?.[0] ?? null)}
                  />
                </div>
              ) : null}
              <Field
                label="Número de presentación (opcional)"
                id="tax-filing-external-id"
                value={presentacion.externalId}
                onChange={(event) => setPresentacion({ ...presentacion, externalId: event.target.value })}
              />
            </div>
          )}
        </section>

        <section className="legajo-cajon-impuesto__seccion study-form__full" aria-label="Declaración jurada">
          <h3>Declaración jurada</h3>
          {!canFile ? (
            <p>
              {conDj
                ? `Declaración jurada cargada · total a pagar ${formatMoney(posicion.totalAPagar)}`
                : "Falta la declaración jurada: la carga el Titular, el Administrador o el Revisor."}
            </p>
          ) : (
            <div className="study-form study-form--presentacion">
              {conDj ? (
                <p className="muted-copy study-form__full" role="status">
                  Declaración jurada cargada. Podés corregirla: la corrección reemplaza a la vigente y queda en el historial.
                </p>
              ) : null}
              {IMPORTES.map(([campo, etiqueta]) => (
                <MoneyField
                  key={campo}
                  id={`dj-${campo}`}
                  label={etiqueta}
                  value={dj[campo]}
                  onChange={(value) => setDj((f) => ({ ...f, [campo]: value }))}
                  hint={difiere(campo)}
                  required
                />
              ))}
              <AsyncState
                loading={documentsQuery.isPending}
                error={documentsQuery.isError}
                loadingLabel="Cargando los documentos del cliente…"
                errorTitle="No pudimos cargar los documentos del cliente"
                errorDescription="Reintentá en un momento."
                onRetry={() => void documentsQuery.refetch()}
                className="study-form__full"
              />
              {documentsQuery.isSuccess ? (
                <>
                  {opcionesDj.length > 0 ? (
                    <div className="ds-field study-form__full">
                      <label className="ds-field__label" htmlFor="dj-documento">
                        Documento de respaldo
                      </label>
                      <SearchSelect
                        id="dj-documento"
                        label="Documento de respaldo"
                        hideLabel
                        className="ds-field__input"
                        value={dj.documentId}
                        onChange={(value) => setDj((f) => ({ ...f, documentId: value }))}
                        placeholder="Subir una declaración jurada nueva"
                        options={opcionesDj.map((o) => ({ value: o.id, label: o.label }))}
                      />
                    </div>
                  ) : null}
                  {!dj.documentId ? (
                    <div className="study-form__full">
                      {declaraciones.length === 0 ? (
                        <p className="muted-copy">Todavía no hay declaraciones juradas subidas para este cliente.</p>
                      ) : null}
                      <Field
                        label="Archivo de la declaración jurada"
                        id="dj-archivo"
                        type="file"
                        accept={RECEIPT_ACCEPT}
                        hint="PDF o imagen. No se lee con IA: los importes son los de arriba."
                        onChange={(event) => setArchivoDj(event.target.files?.[0] ?? null)}
                      />
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
          {advertencias ? (
            <Notice tone="warning" title="Declaración jurada cargada con diferencias">
              <p>Las diferencias no bloquean el período: quedan como aviso para revisar.</p>
              <ul>
                {advertencias.map((aviso) => (
                  <li key={aviso.code}>{aviso.message}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </section>
        <WorkpaperActionError error={guardarMutation.error} />
      </form>

      <section className="legajo-cajon-impuesto__seccion" aria-label="Pago">
        <h3>Pago</h3>
        {pagado && !aPagar ? (
          <p role="status">Pagado {formatMoney(posicion.paid)}.</p>
        ) : !aPagar ? (
          <p role="status">No requiere pago: el saldo es cero o a favor.</p>
        ) : !canPay ? (
          <p>Tu perfil no tiene permiso para registrar el pago.</p>
        ) : !presentada ? (
          <p role="status">Falta registrar la presentación para poder registrar el pago.</p>
        ) : (
          <form
            id="legajo-pago"
            className="study-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (motivoPago === null) pagoMutation.mutate();
            }}
          >
            <p className="muted-copy study-form__full">
              Pendiente: {formatMoney(posicion.pending)}
              {pagado ? ` · pagado ${formatMoney(posicion.paid)}` : ""}
            </p>
            <MoneyField
              label="Importe"
              id="tax-payment-amount"
              value={pago.amount}
              onChange={(value) => setPago({ ...pago, amount: value })}
              required
            />
            <Field
              label="Fecha de pago"
              id="tax-payment-date"
              type="date"
              value={pago.paidAt}
              onChange={(event) => setPago({ ...pago, paidAt: event.target.value })}
              required
            />
            <div className="ds-field">
              <label className="ds-field__label" htmlFor="tax-payment-method">
                Medio
              </label>
              <SearchSelect
                id="tax-payment-method"
                label="Medio"
                hideLabel
                className="ds-field__input"
                value={pago.method}
                onChange={(value) => setPago({ ...pago, method: value })}
                allowEmpty={false}
                options={[
                  { value: "TRANSFERENCIA", label: "Transferencia" },
                  { value: "VEP", label: "VEP" },
                  { value: "EFECTIVO", label: "Efectivo" },
                  { value: "OTRO", label: "Otro" },
                ]}
              />
            </div>
            <Field
              label="Referencia (opcional)"
              id="tax-payment-reference"
              value={pago.reference}
              onChange={(event) => setPago({ ...pago, reference: event.target.value })}
            />
            <WorkpaperActionError error={pagoMutation.error} />
            <div className="study-form__full legajo-cajon-impuesto__pago">
              {motivoPago ? <p className="muted-copy" role="note">{motivoPago}</p> : null}
              <Button type="submit" variant="secondary" loading={pagoMutation.isPending} disabled={motivoPago !== null}>
                Registrar pago
              </Button>
            </div>
          </form>
        )}
      </section>
    </ActionDrawer>
  );
}
