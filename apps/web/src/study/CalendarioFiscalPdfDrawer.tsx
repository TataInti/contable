import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { TAX_CALENDAR_PDF_MAX_BYTES } from "@contable/contracts";
import { AsyncState, Button, Field, Notice, useNotify } from "@contable/design-system";
import { api } from "../lib/api";
import { ActionDrawer, ActionDrawerFooter } from "../ui/ActionDrawer";
import { CalendarioFiscalSelect } from "./CalendarioFiscalSelect";
import {
  calendarIssues,
  calendarPayload,
  emptyCalendarForm,
  serverIssues,
  type CalendarDetail,
  type CalendarForm,
} from "./calendariosFiscales";
import {
  useTaxTypesAndRegimes,
  type AuthorityOption,
  type JurisdictionOption,
} from "./calendariosFiscalesHooks";

/**
 * «Cargar calendario desde PDF» (brief 5A): elige organismo, jurisdicción, año, título e impuesto,
 * sube el PDF y la IA propone el borrador. Al terminar abre la ficha, donde se revisa junto al PDF.
 */

export interface LecturaAltaPdf {
  estado: "LEIDA" | "SIN_LECTURA";
  importadas: number;
  rechazadas: number;
  dudosas: number;
  motivo: string | null;
}

interface ResultadoAltaPdf {
  calendar: CalendarDetail;
  lectura: LecturaAltaPdf;
}

const PDF_ERRORS = {
  tipo: "Elegí un archivo PDF: el calendario se lee en formato PDF.",
  tamano: `El PDF pesa más de ${(TAX_CALENDAR_PDF_MAX_BYTES / (1024 * 1024)).toFixed(0)} MB. Bajá la calidad del archivo o subí solo las páginas del calendario.`,
} as const;

const DRAWER_FIELD_IDS = {
  taxAuthorityId: "cal-pdf-organismo",
  jurisdictionId: "cal-pdf-jurisdiccion",
  taxTypeId: "cal-pdf-impuesto",
  year: "cal-pdf-anio",
  title: "cal-pdf-titulo",
  pdfBase64: "cal-pdf-archivo",
} as const;

const ORDEN_CAMPOS = [
  "taxAuthorityId",
  "jurisdictionId",
  "year",
  "title",
  "taxTypeId",
  "pdfBase64",
] as const;
type CampoAlta = (typeof ORDEN_CAMPOS)[number];

const ETIQUETAS_VACIAS: Record<CampoAlta, string> = {
  taxAuthorityId: "organismo",
  jurisdictionId: "jurisdicción",
  year: "año",
  title: "título",
  taxTypeId: "impuesto",
  pdfBase64: "PDF del calendario",
};

function listaCon(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** Lee el archivo y devuelve su contenido en base64 (sin el prefijo data:). */
export function leerPdfComoBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => {
      const texto = String(lector.result ?? "");
      resolve(texto.slice(texto.indexOf(",") + 1));
    };
    lector.onerror = () => reject(lector.error ?? new Error("No se pudo leer el archivo"));
    lector.readAsDataURL(file);
  });
}

/** Errores del archivo elegido en el navegador: tipo y tamaño. */
export function errorDelPdf(file: File | null): string | null {
  if (file === null) return null;
  const esPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!esPdf) return PDF_ERRORS.tipo;
  if (file.size > TAX_CALENDAR_PDF_MAX_BYTES) return PDF_ERRORS.tamano;
  return null;
}

export function CalendarioFiscalPdfDrawer({
  isOpen,
  onClose,
  firmId,
  authorities,
  jurisdictions,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  firmId: string | null;
  authorities: UseQueryResult<AuthorityOption[]>;
  jurisdictions: UseQueryResult<JurisdictionOption[]>;
  onCreated: (id: string) => void;
}) {
  // El panel se monta solo mientras está abierto: cada apertura empieza en blanco.
  if (!isOpen) return null;
  return (
    <CalendarioFiscalPdfPanel
      onClose={onClose}
      firmId={firmId}
      authorities={authorities}
      jurisdictions={jurisdictions}
      onCreated={onCreated}
    />
  );
}

function CalendarioFiscalPdfPanel({
  onClose,
  firmId,
  authorities,
  jurisdictions,
  onCreated,
}: {
  onClose: () => void;
  firmId: string | null;
  authorities: UseQueryResult<AuthorityOption[]>;
  jurisdictions: UseQueryResult<JurisdictionOption[]>;
  onCreated: (id: string) => void;
}) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { taxTypes } = useTaxTypesAndRegimes(firmId, true);
  const [form, setForm] = useState<CalendarForm>(emptyCalendarForm);
  const [taxTypeId, setTaxTypeId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [serverNotice, setServerNotice] = useState<string | null>(null);

  const issues: Record<string, string> = { ...calendarIssues(form) };
  if (taxTypeId === "") issues.taxTypeId = "Elegí el impuesto al que aplica el calendario";
  const fileIssue = errorDelPdf(file);
  if (fileIssue !== null) issues.pdfBase64 = fileIssue;
  else if (file === null) issues.pdfBase64 = "Elegí el PDF del calendario";

  const vacios: string[] = [];
  if (form.taxAuthorityId === "") vacios.push(ETIQUETAS_VACIAS.taxAuthorityId);
  if (form.jurisdictionId === "") vacios.push(ETIQUETAS_VACIAS.jurisdictionId);
  if (form.year.trim() === "") vacios.push(ETIQUETAS_VACIAS.year);
  if (form.title.trim() === "") vacios.push(ETIQUETAS_VACIAS.title);
  if (taxTypeId === "") vacios.push(ETIQUETAS_VACIAS.taxTypeId);
  if (file === null) vacios.push(ETIQUETAS_VACIAS.pdfBase64);
  const primero = ORDEN_CAMPOS.find((key) => issues[key] !== undefined);
  const motivo =
    vacios.length > 0
      ? `Completá ${listaCon(vacios)}.`
      : primero !== undefined
        ? `Revisá ${ETIQUETAS_VACIAS[primero]}.`
        : null;

  const errorFor = (key: string): string | undefined =>
    (submitted || touched[key] ? issues[key] : undefined) ?? serverFields[key];

  const change = (key: keyof CalendarForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setTouched((current) => ({ ...current, [key]: true }));
    setServerFields({});
    setServerNotice(null);
  };

  const create = useMutation({
    mutationFn: async () => {
      if (file === null) throw new Error("Elegí el PDF del calendario");
      const pdfBase64 = await leerPdfComoBase64(file);
      return api.post<ResultadoAltaPdf>(`/firms/${firmId}/tax-calendars/from-pdf`, {
        ...calendarPayload(form),
        taxTypeId,
        pdfBase64,
        originalName: file.name,
      });
    },
    onSuccess: ({ calendar, lectura }) => {
      void queryClient.invalidateQueries({ queryKey: ["tax-calendars", firmId] });
      if (lectura.estado === "LEIDA") {
        const dudas =
          lectura.dudosas > 0
            ? `; ${lectura.dudosas} ${lectura.dudosas === 1 ? "quedó dudosa" : "quedaron dudosas"} para revisar`
            : "";
        notify.success(
          `Se propusieron ${lectura.importadas} celdas${dudas}. Revisalas junto al PDF antes de publicar.`,
        );
      } else {
        notify.info(`Se creó el borrador. ${lectura.motivo ?? ""}`.trim());
      }
      onCreated(calendar.id);
    },
    onError: (error) => {
      const parsed = serverIssues(error);
      if (Object.keys(parsed.fields).length > 0) setServerFields(parsed.fields);
      else setServerNotice(parsed.message);
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (primero !== undefined) {
      document.getElementById(DRAWER_FIELD_IDS[primero])?.focus();
      return;
    }
    create.mutate();
  };

  return (
    <ActionDrawer
      isOpen
      onClose={onClose}
      title="Cargar calendario desde PDF"
      description="La IA lee el PDF y propone las celdas del calendario. Las celdas se asocian al impuesto elegido, y vos las revisás junto al PDF antes de publicar."
      footer={
        <ActionDrawerFooter
          primary={
            <Button
              type="submit"
              form="cargar-calendario-pdf-form"
              variant="primary"
              loading={create.isPending}
              disabled={motivo !== null}
            >
              Leer PDF y armar borrador
            </Button>
          }
          hint={motivo}
          onCancel={onClose}
        />
      }
    >
      <form
        id="cargar-calendario-pdf-form"
        className="study-form study-form--alinear-arriba"
        noValidate
        onSubmit={onSubmit}
      >
        {serverNotice ? <Notice tone="error">{serverNotice}</Notice> : null}
        {authorities.isError ? (
          <AsyncState
            loading={false}
            error
            loadingLabel="Cargando organismos"
            errorTitle="No se pudieron cargar los organismos"
            errorDescription="Reintentá para elegir el organismo del calendario."
            onRetry={() => void authorities.refetch()}
          />
        ) : null}
        <CalendarioFiscalSelect
          id={DRAWER_FIELD_IDS.taxAuthorityId}
          required
          label="Organismo"
          value={form.taxAuthorityId}
          placeholder="Elegí el organismo"
          options={(authorities.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
          onChange={(value) => change("taxAuthorityId", value)}
          error={errorFor("taxAuthorityId")}
        />
        {jurisdictions.isError ? (
          <AsyncState
            loading={false}
            error
            loadingLabel="Cargando jurisdicciones"
            errorTitle="No se pudieron cargar las jurisdicciones"
            errorDescription="Reintentá para elegir la jurisdicción del calendario."
            onRetry={() => void jurisdictions.refetch()}
          />
        ) : null}
        <CalendarioFiscalSelect
          id={DRAWER_FIELD_IDS.jurisdictionId}
          required
          label="Jurisdicción"
          value={form.jurisdictionId}
          placeholder="Elegí la jurisdicción"
          options={(jurisdictions.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
          onChange={(value) => change("jurisdictionId", value)}
          error={errorFor("jurisdictionId")}
        />
        <CalendarioFiscalSelect
          id={DRAWER_FIELD_IDS.taxTypeId}
          required
          label="Impuesto al que aplica"
          value={taxTypeId}
          placeholder="Elegí el impuesto"
          options={(taxTypes.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
          onChange={(value) => {
            setTaxTypeId(value);
            setTouched((current) => ({ ...current, taxTypeId: true }));
            setServerFields({});
            setServerNotice(null);
          }}
          error={errorFor("taxTypeId")}
        />
        <Field
          id={DRAWER_FIELD_IDS.year}
          required
          name="year"
          label="Año *"
          className="calendario-anio"
          hint="Entre 2000 y 2100."
          inputMode="numeric"
          value={form.year}
          onChange={(event) => change("year", event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, year: true }))}
          error={errorFor("year")}
        />
        <Field
          id={DRAWER_FIELD_IDS.title}
          required
          name="title"
          label="Título *"
          hint="Cómo se llama en el PDF, por ejemplo «Calendario nacional 2026»."
          value={form.title}
          onChange={(event) => change("title", event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, title: true }))}
          error={errorFor("title")}
        />
        <Field
          id={DRAWER_FIELD_IDS.pdfBase64}
          required
          name="pdf"
          type="file"
          accept="application/pdf,.pdf"
          label="PDF del calendario *"
          hint="PDF de hasta 5 MB. El archivo original queda guardado con el calendario."
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setTouched((current) => ({ ...current, pdfBase64: true }));
            setServerFields({});
            setServerNotice(null);
          }}
          onBlur={() => setTouched((current) => ({ ...current, pdfBase64: true }))}
          error={errorFor("pdfBase64")}
        />
      </form>
    </ActionDrawer>
  );
}
