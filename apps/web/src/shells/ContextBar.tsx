import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import { StatusBadge } from "../ui/StatusBadge";
import "./ContextBar.css";
import { SearchSelect } from "@contable/design-system";

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

export function ContextBar({ only }: { only?: "period" } = {}) {
  // `only="period"`: el estudio ya eligió cliente en el menú lateral; la barra
  // se reduce al selector de período contable.
  const periodOnly = only === "period";
  const { firmId, clientId, periodId, setFirmId, setClientId, setPeriodId } = useClientContext();
  const { me, portalContexts } = useSession();
  const portal = useLocation().pathname.startsWith("/portal");
  // El selector de estudio pertenece únicamente a la administración general.
  // Dentro del estudio y en el portal se trabaja sobre el único estudio
  // disponible para esa sesión; el multi-tenant queda fuera de esa vista.
  const showFirmSelector = me?.isPlatformAdmin === true;
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
  const selectedFirmName = firms.find((firm) => firm.firmId === firmId)?.firmName;
  const role = portal
    ? portalContexts.find((item) => item.firmId === firmId && item.clientId === clientId)?.role
    : me?.firms.find((item) => item.firmId === firmId)?.role;

  return (
    <div
      id="context-bar"
      className={`ctxbar${portal ? " ctxbar--portal" : ""}`}
      aria-label="Contexto de trabajo"
    >
      {periodOnly ? null : (
      <div className="ctxbar__intro">
        <span>
          <strong>{portal ? "Empresa activa" : "Contexto de trabajo"}</strong>
          <small>{ROLE_LABELS[role ?? ""] ?? role ?? "Seleccioná el alcance"}</small>
        </span>
      </div>
      )}

      <div className="ctxbar__selectors">
        {periodOnly ? null : showFirmSelector ? (
          <div className="ctxbar__item">
            <span className="ctxbar__label">Estudio</span>
            <span className="ctxbar__select-wrap">
              <SearchSelect
                hideLabel
                label="Estudio"
                className="ctxbar__input"
                value={firmId ?? ""}
                onChange={(value) => setFirmId(value || null)}
                placeholder={firms.length === 0 ? "Sin estudios disponibles" : "Elegí un estudio"}
                allowEmpty={!firmId}
                options={firms.map((firm) => ({ value: firm.firmId, label: firm.firmName }))}
              />
            </span>
          </div>
        ) : (
          <div className="ctxbar__item">
            <span className="ctxbar__label">Estudio</span>
            <span className="ctxbar__static-value">{selectedFirmName ?? "Estudio contable"}</span>
          </div>
        )}
        {periodOnly ? null : (
        <div className="ctxbar__item">
          <span className="ctxbar__label">Cliente</span>
          <span className="ctxbar__select-wrap">
            <SearchSelect
              hideLabel
              label="Cliente"
              className="ctxbar__input"
              value={clientId ?? ""}
              disabled={!firmId || clients.length === 0}
              onChange={(value) => setClientId(value || null)}
              placeholder={!firmId ? "Primero elegí estudio" : clients.length === 0 ? "Sin clientes asignados" : "Elegí un cliente"}
              allowEmpty={!clientId}
              options={clients.map((client) => ({ value: client.clientId, label: client.clientName }))}
            />
          </span>
        </div>
        )}
        <div className="ctxbar__item ctxbar__item--period">
          <span className="ctxbar__label">Período</span>
          <span className="ctxbar__select-wrap">
            <SearchSelect
              hideLabel
              label="Período"
              className="ctxbar__input ctxbar__input--period"
              value={periodId ?? ""}
              disabled={!clientId || periods.length === 0}
              onChange={(value) => setPeriodId(value || null)}
              placeholder={!clientId ? "Sin cliente" : periods.length === 0 ? "Sin períodos" : "Elegí un período"}
              allowEmpty={!periodId}
              options={periods.map((period) => ({ value: period.periodId, label: period.label }))}
            />
          </span>
        </div>
      </div>

      {selectedPeriod ? (
        <div className="ctxbar__period-state" title="Estado del período seleccionado">
          <StatusBadge status={selectedPeriod.status} />
        </div>
      ) : null}
    </div>
  );
}
