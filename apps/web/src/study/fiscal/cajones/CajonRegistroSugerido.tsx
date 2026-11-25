import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Field, SearchSelect } from "@contable/design-system";
import { api } from "../../../lib/api";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { MutationError } from "../MutationError";

import { primerDiaMesAnterior } from "../fechas";
import "./CajonRegistroSugerido.css";
import { etiquetaRegimen } from "../etiquetaRegimen";
import {
  ACTIVIDADES_MONOTRIBUTO,
  CATEGORIAS_MONOTRIBUTO,
  mesActualMonotributo,
  type EstadoMonotributo,
} from "../monotributo";
import type { CategoriaTemEstado } from "../categoriaTem";
import type { EconomicActivity, TaxRegime } from "../utilidades";

type Props = {
  open: boolean;
  onClose: () => void;
  firmId: string;
  clientId: string;
  profileId?: string;
  regimes: TaxRegime[];
  activities: EconomicActivity[];
  tem?: CategoriaTemEstado;
  mono?: EstadoMonotributo;
  refresh: () => void;
};

export function CajonRegistroSugerido({
  open,
  onClose,
  firmId,
  clientId,
  profileId,
  regimes,
  activities,
  tem,
  mono,
  refresh,
}: Props) {
  const [regimeIds, setRegimeIds] = useState<string[]>([]);
  const [activityIds, setActivityIds] = useState<string[]>([]);
  const [desde, setDesde] = useState(primerDiaMesAnterior);
  const [fechaTexto, setFechaTexto] = useState("");
  const [temCategory, setTemCategory] = useState("");
  const [monoCategory, setMonoCategory] = useState("A");
  const [monoActivity, setMonoActivity] = useState("SERVICIOS");
  const queryClient = useQueryClient();
  const temSelected = regimes.some(
    (regime) => regime.code === "TEM_SMT" && regimeIds.includes(regime.id),
  );
  const monoSelected = regimes.some(
    (regime) => regime.code === "MONOTRIBUTO" && regimeIds.includes(regime.id),
  );
  useEffect(() => {
    if (!open) return;
    setRegimeIds(regimes.map((regime) => regime.id));
    setActivityIds(activities.map((activity) => activity.id));
    setDesde(primerDiaMesAnterior());
    setFechaTexto(primerDiaMesAnterior().split("-").reverse().join("/"));
    setTemCategory(
      tem?.category ??
        (tem?.options.some((option) => option.category === "B")
          ? "B"
          : (tem?.options[0]?.category ?? "")),
    );
    setMonoCategory(mono?.category?.category ?? "A");
    setMonoActivity(mono?.category?.activity ?? "SERVICIOS");
  }, [
    open,
    regimes,
    activities,
    tem?.category,
    tem?.options,
    mono?.category?.category,
    mono?.category?.activity,
  ]);
  const guardar = useMutation({
    mutationFn: async () => {
      const base = `/firms/${firmId}/clients/${clientId}`;
      // Cada alta es independiente: si falla una, la próxima apertura descarta las ya registradas.
      for (const regimeId of regimeIds) {
        await api.post(`${base}/tax-registrations`, {
          profileVersionId: profileId,
          regimeId,
          validFrom: desde,
        });
        await queryClient.invalidateQueries({ queryKey: ["tax-registrations", firmId, clientId] });
      }
      for (const activityId of activityIds) {
        await api.post(`${base}/activities`, {
          profileVersionId: profileId,
          activityId,
          isPrimary: true,
        });
        await queryClient.invalidateQueries({
          queryKey: ["client-tax-activities", firmId, clientId],
        });
      }
      if (temSelected && temCategory)
        await api.put(`${base}/tem-categories/${tem!.year}`, { category: temCategory });
      if (monoSelected)
        await api.put(`${base}/monotributo-categories/${mesActualMonotributo()}`, {
          category: monoCategory,
          activity: monoActivity,
        });
    },
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: refresh,
  });
  const toggle = (id: string, ids: string[], set: (ids: string[]) => void) =>
    set(ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  const enviar = (event: FormEvent) => {
    event.preventDefault();
    if (desde && profileId && regimeIds.length + activityIds.length > 0) guardar.mutate();
  };
  return (
    <ActionDrawer
      isOpen={open}
      onClose={onClose}
      title="Regímenes sugeridos"
      description="La app propone según los datos del cliente. Confirmá o desmarcá antes de registrar; revisá las categorías propuestas."
    >
      <form className="study-form study-form--compact fiscal-suggestions" onSubmit={enviar}>
        <fieldset>
          <legend>Regímenes</legend>
          {regimes.map((regime) => (
            <label key={regime.id} title={etiquetaRegimen(regime)}>
              <input
                type="checkbox"
                checked={regimeIds.includes(regime.id)}
                onChange={() => toggle(regime.id, regimeIds, setRegimeIds)}
              />{" "}
              {({ RI: "IVA · Responsable Inscripto", IIBB_LOCAL_TUC: "IIBB Tucumán", TEM_SMT: "TEM San Miguel" } as Record<string, string>)[regime.code] ?? regime.name}
            </label>
          ))}
        </fieldset>
        <Field
          label="Desde"
          id="sugeridos-desde"
          value={fechaTexto}
          placeholder="dd/mm/aaaa"
          inputMode="numeric"
          pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}"
          onChange={(event) => {
            const value = event.target.value;
            setFechaTexto(value);
            const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
            const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : "";
            const date = iso ? new Date(`${iso}T00:00:00Z`) : null;
            setDesde(date && !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso ? iso : "");
          }}
          required
        />
        {activities.length ? (
          <fieldset>
            <legend>Actividades propuestas</legend>
            {activities.map((activity) => (
              <label key={activity.id}>
                <input
                  type="checkbox"
                  checked={activityIds.includes(activity.id)}
                  onChange={() => toggle(activity.id, activityIds, setActivityIds)}
                />{" "}
                {activity.code} — {activity.name}
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="muted-copy">
            Sin actividad coincidente: podés vincularla después en Actividades.
          </p>
        )}
        {temSelected ? (
          <SearchSelect label="Categoría TEM propuesta" value={temCategory} onChange={setTemCategory} placeholder="Elegir después" options={(tem?.options ?? []).map((option) => ({ value: option.category, label: option.label }))} />
        ) : null}
        {monoSelected ? (
          <>
            <SearchSelect label="Categoría Monotributo propuesta" value={monoCategory} onChange={setMonoCategory} allowEmpty={false} options={CATEGORIAS_MONOTRIBUTO.map((category) => ({ value: category, label: category }))} />
            <SearchSelect label="Tipo de actividad" value={monoActivity} onChange={setMonoActivity} allowEmpty={false} options={ACTIVIDADES_MONOTRIBUTO.map((activity) => ({ value: activity.value, label: activity.label }))} />
          </>
        ) : null}
        <MutationError error={guardar.error} />
        <div className="study-form__actions">
          <Button
            type="submit"
            disabled={
              !profileId ||
              !desde ||
              (!regimeIds.length && !activityIds.length) ||
              guardar.isPending
            }
            loading={guardar.isPending}
          >
            Registrar
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </ActionDrawer>
  );
}
