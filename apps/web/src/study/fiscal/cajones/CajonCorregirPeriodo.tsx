import { useEffect, useState } from "react";
import { Button, Field } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { CampoFecha } from "../CampoFecha";
import { campoDelError } from "../campoDelError";
import { MutationError } from "../MutationError";
import type { TaxPeriod } from "../utilidades";

export type CorreccionPeriodo = { id: string; startDate: string; endDate: string; label: string };

type Props = {
  /** Período a corregir; null = cajón cerrado. */
  period: TaxPeriod | null;
  onClose: () => void;
  updatePeriod: { isPending: boolean; error: Error | null; mutate: (valores: CorreccionPeriodo) => void };
};

export function CajonCorregirPeriodo({ period, onClose, updatePeriod }: Props) {
  const [form, setForm] = useState({ startDate: "", endDate: "", label: "" });
  const periodId = period?.id;
  useEffect(() => {
    if (!period) return;
    setForm({ startDate: period.startDate.slice(0, 10), endDate: period.endDate.slice(0, 10), label: period.label ?? "" });
    // Se recarga solo al cambiar de período, no en cada refresco de la lista.
  }, [periodId]);
  const campoApi = campoDelError(updatePeriod.error);
  const mensajeApi = updatePeriod.error?.message;
  const hastaInvalido = form.startDate && form.endDate && form.endDate < form.startDate ? "El «Hasta» no puede ser anterior al «Desde»." : undefined;
  const falta = (valor: string) => (valor ? undefined : "Completá la fecha.");
  return (
    <ActionDrawer
      isOpen={period !== null}
      onClose={onClose}
      title="Corregir período fiscal"
      description={period ? `${period.taxType.name}. Solo se corrigen períodos que todavía no tienen obligación ni documentos.` : ""}
      size="wide"
    >
      <form
        className="study-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!period || !form.startDate || !form.endDate || hastaInvalido) return;
          updatePeriod.mutate({ id: period.id, ...form });
        }}
      >
        <CampoFecha label="Desde" id="per-edit-start" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} error={falta(form.startDate) ?? (campoApi === "startDate" ? mensajeApi : undefined)} required />
        <CampoFecha label="Hasta" id="per-edit-end" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} error={falta(form.endDate) ?? hastaInvalido ?? (campoApi === "endDate" ? mensajeApi : undefined)} required />
        <Field label="Etiqueta (opcional)" id="per-edit-label" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Ej. Octubre 2026" />
        {campoApi === "startDate" || campoApi === "endDate" ? null : <MutationError error={updatePeriod.error} />}
        <div className="study-form__actions"><Button type="submit" loading={updatePeriod.isPending}>Guardar período</Button><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button></div>
      </form>
    </ActionDrawer>
  );
}
