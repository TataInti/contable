import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Table } from "@contable/design-system";
import { api, type FeatureFlag } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
import { SectionIndex } from "../ui/SectionIndex";
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
    <div className="study-page">
      <div className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Administración general</p>
          <h1 className="study-page__title">Módulos de estudios</h1>
          <p className="study-page__subtitle">
            Habilitá o deshabilitá módulos para el estudio seleccionado. El acceso de cada persona
            dentro del estudio se define aparte mediante su rol.
          </p>
        </div>
      </div>

      <SectionIndex
        items={[
          { id: "platform-context-title", label: "Estudio" },
          { id: "platform-modules-title", label: "Módulos", meta: String(flags.data?.length ?? 0) },
        ]}
      />

      {notice ? (
        <div className="action-receipt action-receipt--page" role="status">
          <Icon name="check" size={18} />
          <span>
            <strong>Acción completada</strong>
            <small>{notice}</small>
          </span>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}>
            <Icon name="close" size={15} />
          </button>
        </div>
      ) : null}
      {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}

      <section className="study-panel administration-context" aria-labelledby="platform-context-title">
        <div className="administration-context__heading">
          <div>
            <p className="study-page__eyebrow">Estudio seleccionado</p>
            <h2 id="platform-context-title">{firm?.firmName ?? "Sin estudio seleccionado"}</h2>
            <p>Estos switches afectan la disponibilidad general del módulo para toda la firma.</p>
          </div>
          <StatusBadge status={firmId ? "ACTIVE" : "PENDING"} />
        </div>
      </section>

      <section className="study-panel administration-operational-section" aria-labelledby="platform-modules-title">
        <div className="study-panel__heading">
          <div>
            <h2 id="platform-modules-title">Disponibilidad por estudio</h2>
            <p>La asignación de acceso individual se administra desde Usuarios y accesos.</p>
          </div>
        </div>
        {flags.isLoading ? (
          <div className="query-state" role="status"><span className="loading-copy">Cargando módulos…</span></div>
        ) : flags.isError ? (
          <EmptyState
            title="No se pudo cargar la configuración"
            description="Reintentá antes de cambiar módulos del estudio."
            action={<Button variant="secondary" onClick={() => void flags.refetch()}>Reintentar</Button>}
          />
        ) : (flags.data?.length ?? 0) === 0 ? (
          <EmptyState title="Sin módulos configurados" />
        ) : (
          <Table<FeatureFlag>
            rows={flags.data ?? []}
            rowKey={(flag) => flag.id}
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
        )}
      </section>
      <ConfirmDialog confirm={confirm} />
    </div>
  );
}
