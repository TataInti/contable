import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Switch, useNotify } from "@contable/design-system";
import { api, type FeatureFlag } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
import {
  DenseFooter,
  DenseHeader,
  DenseLoading,
  DensePage,
  DenseSearch,
  DenseTable,
  DenseToolbar,
  DenseWorkspace,
  StatStrip,
  normalizeSearch,
  useDenseShortcuts,
  useDensity,
} from "../ui/Dense";
import "./study.css";

const FEATURE_FLAG_LABELS: Record<string, string> = {
  DOCUMENTS: "Bandeja documental",
  LEDGER: "Contabilidad",
  BANKING: "Bancos",
  TAX: "Módulo fiscal",
  REPORTING: "Reportes",
  PORTAL: "Portal del cliente",
  ASSISTANT: "Asistente contable",
  BI: "Indicadores",
  TAX_RI: "IVA Responsable Inscripto",
  TAX_IIBB_LOCAL_TUC: "Ingresos Brutos Tucumán",
  TAX_TEM_SMT: "TEM San Miguel de Tucumán",
  TAX_CM_ART2: "Convenio Multilateral",
  TAX_MONOTRIBUTO: "Monotributo",
};

export function StudyAdministracionPlataforma() {
  const [density] = useDensity();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"" | "on" | "off">("");
  const searchRef = useRef<HTMLInputElement>(null);
  useDenseShortcuts({ searchRef });
  const { firmId, capabilities } = useClientContext();
  const session = useSession();
  const queryClient = useQueryClient();
  const confirm = useConfirmAction();
  const notify = useNotify();
  const firm = session.me?.firms.find((item) => item.firmId === firmId);
  const flags = useQuery({
    queryKey: ["flags", firmId],
    queryFn: () => api.get<FeatureFlag[]>(`/firms/${firmId}/feature-flags`),
    enabled: Boolean(firmId && capabilities.has("platform.modules.manage")),
  });
  const allFlags = useMemo(() => flags.data ?? [], [flags.data]);
  const visibleFlags = useMemo(() => {
    const needle = normalizeSearch(search);
    return allFlags.filter((flag) => {
      if (stateFilter === "on" && !flag.enabled) return false;
      if (stateFilter === "off" && flag.enabled) return false;
      if (!needle) return true;
      return normalizeSearch(`${FEATURE_FLAG_LABELS[flag.code] ?? ""} ${flag.code}`).includes(needle);
    });
  }, [allFlags, search, stateFilter]);
  const updateFlag = useMutation({
    mutationFn: (flag: FeatureFlag) =>
      api.put(`/firms/${firmId}/feature-flags/${flag.code}`, { enabled: !flag.enabled }),
    onSuccess: (_result, flag) => {
      notify.success(`${FEATURE_FLAG_LABELS[flag.code] ?? flag.code} quedó ${flag.enabled ? "deshabilitado" : "habilitado"}.`);
      void queryClient.invalidateQueries({ queryKey: ["flags", firmId] });
    },
    onError: (error) =>
      notify.error(error instanceof Error ? error.message : "No se pudo actualizar el módulo."),
  });

  if (!capabilities.has("platform.modules.manage")) {
    return (
      <div className="study-page">
        <EmptyState
          title="Acceso restringido"
          description="Sólo la administración general puede habilitar módulos para un estudio."
        />
      </div>
    );
  }

  return (
    <DensePage density={density}>
      <DenseHeader
        title="Módulos de estudios"
        description={`Lo que ${firm?.firmName ?? "el estudio"} tiene disponible. El acceso de cada persona se define aparte, con su rol.`}
      />

      <StatStrip
        label="Resumen de módulos"
        items={[
          { key: "modules", label: "Módulos", value: allFlags.length },
          { key: "on", label: "Habilitados", value: allFlags.filter((flag) => flag.enabled).length },
          {
            key: "off",
            label: "Deshabilitados",
            value: allFlags.filter((flag) => !flag.enabled).length,
            tone: allFlags.some((flag) => !flag.enabled) ? "warn" : undefined,
          },
        ]}
      />

      <DenseToolbar>
        <DenseSearch
          inputRef={searchRef}
          value={search}
          onChange={setSearch}
          placeholder="Buscar módulo…"
          label="Buscar módulos"
        />
        <select
          className="dense-select"
          aria-label="Filtrar por estado"
          value={stateFilter}
          onChange={(event) => setStateFilter(event.target.value as "" | "on" | "off")}
        >
          <option value="">Estado: todos</option>
          <option value="on">Habilitados</option>
          <option value="off">Deshabilitados</option>
        </select>
      </DenseToolbar>

      {flags.isLoading ? (
        <DenseLoading label="Cargando módulos…" />
      ) : flags.isError ? (
        <EmptyState
          title="No se pudo cargar la configuración"
          description="Reintentá antes de cambiar módulos del estudio."
          action={<Button variant="secondary" onClick={() => void flags.refetch()}>Reintentar</Button>}
        />
      ) : (
        <DenseWorkspace panelId="platform-modules-panel">
          <DenseTable<FeatureFlag>
            label="Disponibilidad por estudio"
            rows={visibleFlags}
            rowKey={(flag) => flag.id}
            footer={
              <DenseFooter
                count={visibleFlags.length}
                noun={visibleFlags.length === 1 ? "módulo" : "módulos"}
                hint="La asignación de acceso individual se administra desde Usuarios y accesos."
                newShortcut={false}
              />
            }
            empty={<EmptyState size="compact" title="Sin módulos configurados" />}
            columns={[
                {
                  key: "code",
                  header: "Módulo",
                  render: (flag) => <><strong>{FEATURE_FLAG_LABELS[flag.code] ?? flag.code}</strong><br /><small>{flag.code}</small></>,
                },
                {
                  key: "enabled",
                  header: "Disponible",
                  render: (flag) => {
                    const name = FEATURE_FLAG_LABELS[flag.code] ?? flag.code;
                    return (
                      <Switch
                        checked={flag.enabled}
                        label={name}
                        text={flag.enabled ? "Habilitado" : "Deshabilitado"}
                        busy={updateFlag.isPending && updateFlag.variables?.id === flag.id}
                        onChange={(next) => {
                          if (next) {
                            updateFlag.mutate(flag);
                            return;
                          }
                          confirm.ask({
                            title: `¿Deshabilitar ${name}?`,
                            description: "El módulo dejará de estar disponible para este estudio hasta que lo vuelvas a habilitar.",
                            confirmLabel: "Deshabilitar",
                            tone: "danger",
                            onConfirm: () => updateFlag.mutate(flag),
                          });
                        }}
                      />
                    );
                  },
                },
              ]}
          />
        </DenseWorkspace>
      )}
      <ConfirmDialog confirm={confirm} />
    </DensePage>
  );
}
