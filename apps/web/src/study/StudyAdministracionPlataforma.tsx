import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState } from "@contable/design-system";
import { api, type FeatureFlag } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
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
  DensitySwitch,
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
  const [density, setDensity] = useDensity();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"" | "on" | "off">("");
  const searchRef = useRef<HTMLInputElement>(null);
  useDenseShortcuts({ searchRef });
  const { firmId, capabilities } = useClientContext();
  const session = useSession();
  const queryClient = useQueryClient();
  const confirm = useConfirmAction();
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
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
      setActionError(null);
      setNotice(`${FEATURE_FLAG_LABELS[flag.code] ?? flag.code} quedó ${flag.enabled ? "deshabilitado" : "habilitado"}.`);
      void queryClient.invalidateQueries({ queryKey: ["flags", firmId] });
    },
    onError: (error) =>
      setActionError(error instanceof Error ? error.message : "No se pudo actualizar el módulo."),
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
        eyebrow="Administración general"
        title="Módulos de estudios"
        description="Habilitá o deshabilitá módulos para el estudio seleccionado. El acceso de cada persona dentro del estudio se define aparte mediante su rol."
      />

      <StatStrip
        label="Resumen de módulos"
        items={[
          { key: "firm", label: "Estudio", value: firm?.firmName ?? "Sin estudio seleccionado" },
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


      {notice ? (
        <div className="action-receipt action-receipt--page" role="status">
          <Icon name="check" size={18} />
          <span>
            <strong>Acción completada</strong>
            <small>{notice}</small>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Cerrar aviso"
            onClick={() => setNotice(null)}
          >
            <Icon name="close" size={15} />
          </Button>
        </div>
      ) : null}
      {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}


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
        <span className="dense-toolbar__spacer" />
        <DensitySwitch value={density} onChange={setDensity} />
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
                  header: "Estado",
                  render: (flag) => <StatusBadge status={flag.enabled ? "ACTIVE" : "DISABLED"} />,
                },
                {
                  key: "action",
                  header: "Acción",
                  render: (flag) => (
                    <Button
                      size="sm"
                      variant={flag.enabled ? "danger" : "secondary"}
                      loading={updateFlag.isPending && updateFlag.variables?.id === flag.id}
                      onClick={() => {
                        if (!flag.enabled) {
                          updateFlag.mutate(flag);
                          return;
                        }
                        confirm.ask({
                          title: `¿Deshabilitar ${FEATURE_FLAG_LABELS[flag.code] ?? flag.code}?`,
                          description: "El módulo dejará de estar disponible para este estudio hasta que lo vuelvas a habilitar.",
                          confirmLabel: "Deshabilitar",
                          tone: "danger",
                          onConfirm: () => updateFlag.mutate(flag),
                        });
                      }}
                    >
                      {flag.enabled ? "Deshabilitar" : "Habilitar"}
                    </Button>
                  ),
                },
              ]}
          />
        </DenseWorkspace>
      )}
      <ConfirmDialog confirm={confirm} />
    </DensePage>
  );
}
