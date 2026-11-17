import { useState } from "react";
import { useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  AsyncState,
  Button,
  Field,
  getStatusBadgeMeta,
  MoneyField,
  Notice,
  useNotify,
} from "@contable/design-system";
import {
  FILING_DECLARATION_DOCUMENT_CATEGORY,
  taxFilingCreditDetailReadSchema,
  type TaxFilingDeclarationWarning,
} from "@contable/contracts";
import { api } from "../../../lib/api";
import { ActionDrawer, ActionDrawerFooter } from "../../../ui/ActionDrawer";
import {
  RECEIPT_ACCEPT,
  uploadPresentacionDocument,
  waitForReceiptReady,
} from "../../filingReceipt";
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

type Form = Record<(typeof IMPORTES)[number][0], string> & { documentId: string };

// «1234.5600» → «1234.56».
const sinCeros = (valor?: string | null) =>
  (valor ?? "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

// Corregir reenvía el detalle guardado: si no llega, la API lo borra.
const detalleGuardado = (valor: unknown) =>
  (taxFilingCreditDetailReadSchema.safeParse(valor).data ?? []).map(
    ({ regimeId, jurisdictionId, ...item }) => ({
      ...item,
      ...(regimeId ? { regimeId } : {}),
      ...(jurisdictionId ? { jurisdictionId } : {}),
    }),
  );

// Primer dato que falta: se muestra junto al botón deshabilitado (P1 y P4).
function motivoDe(
  f: Form,
  docs: { isPending: boolean; isError: boolean },
  conArchivo: boolean,
): string | null {
  if (!f.impuestoDeterminado) return "Indicá el impuesto determinado.";
  if (!f.saldoFavorTecnico) return "Indicá el saldo a favor técnico.";
  if (!f.saldoLibreDisponibilidad) return "Indicá el saldo a favor de libre disponibilidad.";
  if (!f.totalAPagar) return "Indicá el total a pagar.";
  if (f.documentId) return null;
  if (docs.isPending) return "Esperá a que carguen los documentos del cliente.";
  if (docs.isError) return "No pudimos cargar los documentos. Reintentá.";
  return conArchivo ? null : "Adjuntá la declaración jurada.";
}

interface PanelDeclaracionProps {
  posicion: TaxPosition;
  onCerrar: () => void;
  firmId: string;
  clientId: string;
  documentsQuery: UseQueryResult<EvidenceDocument[], Error>;
}

// Se abre desde la fila de Cálculo; al corregir arranca con la DJ vigente.
export function PanelDeclaracion({
  posicion,
  onCerrar,
  firmId,
  clientId,
  documentsQuery,
}: PanelDeclaracionProps) {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const [corregida, setCorregida] = useState(Boolean(posicion.hasDeclaration));
  const [form, setForm] = useState<Form>({
    impuestoDeterminado: sinCeros(posicion.impuestoDeterminado),
    saldoFavorTecnico: sinCeros(posicion.saldoFavorTecnico),
    saldoLibreDisponibilidad: sinCeros(posicion.saldoLibreDisponibilidad),
    totalAPagar: sinCeros(posicion.totalAPagar),
    documentId: posicion.declarationDocumentId ?? "",
  });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [advertencias, setAdvertencias] = useState<TaxFilingDeclarationWarning[] | null>(null);
  const detalle = detalleGuardado(posicion.saldosFavorDetalle);

  const declaraciones = (documentsQuery.data ?? []).filter(
    (d) =>
      d.category === FILING_DECLARATION_DOCUMENT_CATEGORY &&
      ["READY", "APPLIED"].includes(d.status),
  );
  // La seleccionada aparece aunque la lista todavía no la traiga.
  const opciones = [
    ...(form.documentId && !declaraciones.some((d) => d.id === form.documentId)
      ? [{ id: form.documentId, label: "Declaración jurada seleccionada" }]
      : []),
    ...declaraciones.map((d) => ({
      id: d.id,
      label: `${d.fileVersions?.[0]?.originalName ?? "Declaración jurada"} · ${getStatusBadgeMeta(d.status).label}`,
    })),
  ];

  const guardarMutation = useMutation({
    mutationFn: async () => {
      const base = `/firms/${firmId}/clients/${clientId}`;
      let declarationDocumentId = form.documentId;
      // Si el guardado falla después de subir el archivo, el reintento usa ese mismo documento.
      if (!declarationDocumentId && archivo) {
        declarationDocumentId = await uploadPresentacionDocument(
          base,
          archivo,
          FILING_DECLARATION_DOCUMENT_CATEGORY,
        );
        setForm((f) => ({ ...f, documentId: declarationDocumentId }));
        setArchivo(null);
        await queryClient.invalidateQueries({ queryKey: ["documents", firmId, clientId] });
        await waitForReceiptReady(base, declarationDocumentId, { mensajes: MENSAJES_DJ });
      }
      return api.patch<{ warnings: TaxFilingDeclarationWarning[] }>(
        `${base}/tax-obligations/${posicion.obligationId}/filings/${posicion.filingId}/declaration`,
        {
          declarationDocumentId,
          impuestoDeterminado: form.impuestoDeterminado,
          saldoFavorTecnico: form.saldoFavorTecnico,
          saldoLibreDisponibilidad: form.saldoLibreDisponibilidad,
          totalAPagar: form.totalAPagar,
          ...(detalle.length > 0 ? { saldosFavorDetalle: detalle } : {}),
        },
      );
    },
    onSuccess: ({ warnings }) => {
      setCorregida(true);
      void queryClient.invalidateQueries({ queryKey: ["tax-position", firmId, clientId] });
      // Las diferencias informan y no bloquean (D5B-5): el cajón queda abierto para leerlas.
      if (warnings.length > 0) {
        setAdvertencias(warnings);
        return;
      }
      notify.success(corregida ? "Declaración jurada corregida." : "Declaración jurada cargada.");
      onCerrar();
    },
  });

  const motivo = !posicion.filingId
    ? "Falta la presentación con acuse."
    : motivoDe(form, documentsQuery, archivo !== null);

  return (
    <ActionDrawer
      isOpen
      onClose={onCerrar}
      title={`Declaración jurada · ${posicion.regime.taxType.name}`}
      description={
        corregida
          ? "La corrección reemplaza la declaración jurada vigente y queda en el historial."
          : "Cargá los importes de la declaración jurada y su documento de respaldo."
      }
      size="wide"
      footer={
        advertencias ? (
          <ActionDrawerFooter
            primary={<Button onClick={onCerrar}>Cerrar</Button>}
            onCancel={() => setAdvertencias(null)}
            cancelLabel="Volver al formulario"
          />
        ) : (
          <ActionDrawerFooter
            primary={
              <Button
                type="submit"
                form="legajo-declaracion"
                loading={guardarMutation.isPending}
                loadingLabel="Subiendo y validando la declaración jurada"
                disabled={motivo !== null}
              >
                {corregida ? "Guardar corrección" : "Guardar declaración jurada"}
              </Button>
            }
            hint={motivo}
            onCancel={onCerrar}
          />
        )
      }
    >
      {advertencias ? (
        <Notice tone="warning" title="Declaración jurada cargada con diferencias">
          <p>Las diferencias no bloquean el período: quedan como aviso para revisar.</p>
          <ul>
            {advertencias.map((aviso) => (
              <li key={aviso.code}>{aviso.message}</li>
            ))}
          </ul>
        </Notice>
      ) : (
        <form
          id="legajo-declaracion"
          className="study-form study-form--presentacion"
          onSubmit={(event) => {
            event.preventDefault();
            if (motivo === null) guardarMutation.mutate();
          }}
        >
          {IMPORTES.map(([campo, etiqueta]) => (
            <MoneyField
              key={campo}
              id={`dj-${campo}`}
              label={etiqueta}
              value={form[campo]}
              onChange={(value) => setForm((f) => ({ ...f, [campo]: value }))}
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
              <div className="ds-field study-form__full">
                <label className="ds-field__label" htmlFor="dj-documento">
                  Documento de respaldo
                </label>
                <select
                  id="dj-documento"
                  className="ds-field__input"
                  value={form.documentId}
                  onChange={(event) => setForm((f) => ({ ...f, documentId: event.target.value }))}
                >
                  <option value="">Subir una declaración jurada nueva</option>
                  {opciones.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <small className="ds-field__hint">
                  {declaraciones.length === 0 && !form.documentId
                    ? "Todavía no hay declaraciones juradas subidas para este cliente."
                    : "Es la declaración jurada presentada. No se lee con IA: los importes los cargás vos."}
                </small>
              </div>
              {!form.documentId && (
                <div className="study-form__full">
                  <Field
                    label="Archivo de la declaración jurada"
                    id="dj-archivo"
                    type="file"
                    accept={RECEIPT_ACCEPT}
                    hint="PDF o imagen."
                    required
                    onChange={(event) => setArchivo(event.target.files?.[0] ?? null)}
                  />
                </div>
              )}
            </>
          ) : null}
          <WorkpaperActionError error={guardarMutation.error} />
        </form>
      )}
    </ActionDrawer>
  );
}
