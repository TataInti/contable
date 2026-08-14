import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import "./ContextBar.css";

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Titular",
  ADMIN: "Administrador",
  ACCOUNTANT: "Contador",
  PREPARER: "Preparador",
  REVIEWER: "Revisor",
  AUDITOR: "Auditor",
  COLLABORATOR: "Colaborador",
  READONLY: "Sólo lectura",
};

export function ContextBar() {
  const { firmId, clientId, periodId, setFirmId, setClientId, setPeriodId } = useClientContext();
  const { me, portalContexts } = useSession();
  const portal = useLocation().pathname.startsWith("/portal");
  const firms = useMemo(
    () =>
      portal
        ? [
            ...new Map(
              portalContexts.map((item) => [
                item.firmId,
                { firmId: item.firmId, firmName: item.firmName },
              ]),
            ).values(),
          ]
        : (me?.firms ?? []),
    [portal, portalContexts, me],
  );
  const clients = portal
    ? portalContexts
        .filter((item) => item.firmId === firmId)
        .map((item) => ({
          clientId: item.clientId,
          clientName: item.clientName,
          periods: item.periods,
        }))
    : (me?.firms.find((item) => item.firmId === firmId)?.clients ?? []);
  const periods = clients.find((item) => item.clientId === clientId)?.periods ?? [];
  const selectedPeriod = periods.find((period) => period.periodId === periodId);
  const role = portal
    ? portalContexts.find((item) => item.firmId === firmId && item.clientId === clientId)?.role
    : me?.firms.find((item) => item.firmId === firmId)?.role;

  return (
    <div className={`ctxbar${portal ? " ctxbar--portal" : ""}`} aria-label="Contexto de trabajo">
      <div className="ctxbar__intro">
        <span className="ctxbar__scope-icon" aria-hidden="true">
          <Icon name={portal ? "building" : "briefcase"} size={17} />
        </span>
        <span>
          <strong>{portal ? "Empresa activa" : "Contexto de trabajo"}</strong>
          <small>{ROLE_LABELS[role ?? ""] ?? role ?? "Seleccioná el alcance"}</small>
        </span>
      </div>

      <div className="ctxbar__selectors">
        <label className="ctxbar__item">
          <span className="ctxbar__label">Estudio</span>
          <span className="ctxbar__select-wrap">
            <Icon name="building" size={15} />
            <select
              className="ctxbar__input"
              value={firmId ?? ""}
              onChange={(event) => setFirmId(event.target.value || null)}
            >
              {!firmId ? <option value="">Elegí un estudio</option> : null}
              {firms.length === 0 ? <option value="">Sin estudios disponibles</option> : null}
              {firms.map((firm) => (
                <option key={firm.firmId} value={firm.firmId}>
                  {firm.firmName}
                </option>
              ))}
            </select>
          </span>
        </label>
        <span className="ctxbar__separator" aria-hidden="true">
          <Icon name="chevron" size={13} />
        </span>
        <label className="ctxbar__item">
          <span className="ctxbar__label">Cliente</span>
          <span className="ctxbar__select-wrap">
            <Icon name="users" size={15} />
            <select
              className="ctxbar__input"
              value={clientId ?? ""}
              disabled={!firmId || clients.length === 0}
              onChange={(event) => setClientId(event.target.value || null)}
            >
              {!clientId ? (
                <option value="">{firmId ? "Elegí un cliente" : "Primero elegí estudio"}</option>
              ) : null}
              {clients.length === 0 && firmId ? (
                <option value="">Sin clientes asignados</option>
              ) : null}
              {clients.map((client) => (
                <option key={client.clientId} value={client.clientId}>
                  {client.clientName}
                </option>
              ))}
            </select>
          </span>
        </label>
        <span className="ctxbar__separator" aria-hidden="true">
          <Icon name="chevron" size={13} />
        </span>
        <label className="ctxbar__item ctxbar__item--period">
          <span className="ctxbar__label">Período</span>
          <span className="ctxbar__select-wrap">
            <Icon name="calendar" size={15} />
            <select
              className="ctxbar__input ctxbar__input--period"
              value={periodId ?? ""}
              disabled={!clientId || periods.length === 0}
              onChange={(event) => setPeriodId(event.target.value || null)}
            >
              {!periodId ? (
                <option value="">{clientId ? "Elegí un período" : "Sin cliente"}</option>
              ) : null}
              {periods.length === 0 && clientId ? <option value="">Sin períodos</option> : null}
              {periods.map((period) => (
                <option key={period.periodId} value={period.periodId}>
                  {period.label}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>

      {selectedPeriod ? (
        <div className="ctxbar__period-state" title="Estado del período seleccionado">
          <StatusBadge status={selectedPeriod.status} />
        </div>
      ) : null}
    </div>
  );
}
