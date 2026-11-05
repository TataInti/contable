import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import { ACTIVITY_CODE_PATTERN, normalizeActivityCode } from "@contable/contracts";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { ActionDrawer } from "../ui/ActionDrawer";
import "./study.css";

interface JurisdictionOption {
  id: string;
  code: string;
  name: string;
  kind: string;
}

interface TaxTypeOption {
  id: string;
  code: string;
  name: string;
}

interface TaxAuthorityRow {
  id: string;
  code: string;
  name: string;
  jurisdictionId: string;
  isActive: boolean;
  jurisdiction: JurisdictionOption;
}

interface TaxRegimeRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  authority: TaxAuthorityRow;
  jurisdiction: JurisdictionOption;
  taxType: TaxTypeOption;
}

interface AuthorityForm {
  code: string;
  name: string;
  jurisdictionId: string;
}

interface RegimeForm {
  code: string;
  name: string;
  taxTypeId: string;
  jurisdictionId: string;
  authorityId: string;
}

interface CatalogActivityRow {
  id: string;
  code: string;
  name: string;
  jurisdictionId: string;
  source: string | null;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
  activeClientLinks?: number;
}

interface ActivityForm {
  code: string;
  name: string;
  jurisdictionId: string;
  source: string;
  validFrom: string;
  validTo: string;
}

const today = new Date().toISOString().slice(0, 10);

const emptyActivityForm: ActivityForm = {
  code: "",
  name: "",
  jurisdictionId: "",
  source: "",
  validFrom: today,
  validTo: "",
};

function shortDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("es-AR") : "—";
}

function ActivityStateBadge({ isActive }: { isActive: boolean }) {
  return (
    <span className={`study-badge ${isActive ? "study-badge--ok" : "study-badge--muted"}`}>
      {isActive ? "Activa" : "Desactivada"}
    </span>
  );
}

function MutationError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="form-error" role="alert">
      {error instanceof Error ? error.message : "Ocurrió un error inesperado."}
    </p>
  );
}

export function StudyCatalogosFiscales() {
  const { firmId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const canPropose = capabilities.has("tax.rules.propose");
  const [drawer, setDrawer] = useState<"authority" | "regime" | null>(null);
  const [activityDrawer, setActivityDrawer] = useState<"create" | "edit" | "deactivate" | null>(null);
  const [editingActivity, setEditingActivity] = useState<CatalogActivityRow | null>(null);
  const [activityForm, setActivityForm] = useState<ActivityForm>(emptyActivityForm);
  const [activitySearch, setActivitySearch] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [authorityForm, setAuthorityForm] = useState<AuthorityForm>({
    code: "",
    name: "",
    jurisdictionId: "",
  });
  const [regimeForm, setRegimeForm] = useState<RegimeForm>({
    code: "",
    name: "",
    taxTypeId: "",
    jurisdictionId: "",
    authorityId: "",
  });

  const jurisdictionsQuery = useQuery({
    queryKey: ["tax-jurisdictions", firmId],
    queryFn: () => api.get<JurisdictionOption[]>("/tax/jurisdictions"),
    enabled: Boolean(firmId && capabilities.has("tax.rules.read")),
  });
  const taxTypesQuery = useQuery({
    queryKey: ["tax-types", firmId],
    queryFn: () => api.get<TaxTypeOption[]>("/tax/types"),
    enabled: Boolean(firmId && capabilities.has("tax.rules.read")),
  });
  const authoritiesQuery = useQuery({
    queryKey: ["tax-authorities", firmId],
    queryFn: () => api.get<TaxAuthorityRow[]>("/tax/authorities"),
    enabled: Boolean(firmId && capabilities.has("tax.rules.read")),
  });
  const regimesQuery = useQuery({
    queryKey: ["tax-regimes", firmId],
    queryFn: () => api.get<TaxRegimeRow[]>("/tax/regimes"),
    enabled: Boolean(firmId && capabilities.has("tax.rules.read")),
  });
  // La administración del catálogo necesita también las desactivadas:
  // `includeInactive=true` es el parámetro acordado con el servidor.
  const activitiesQuery = useQuery({
    queryKey: ["tax-activities-catalog", firmId],
    queryFn: () => api.get<CatalogActivityRow[]>("/tax/activities?includeInactive=true"),
    enabled: Boolean(firmId && capabilities.has("tax.rules.read")),
  });

  const createAuthority = useMutation({
    mutationFn: () =>
      api.post<TaxAuthorityRow>("/tax/authorities", {
        code: authorityForm.code.trim(),
        name: authorityForm.name.trim(),
        jurisdictionId: authorityForm.jurisdictionId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax-authorities", firmId] });
      setAuthorityForm({ code: "", name: "", jurisdictionId: "" });
      setDrawer(null);
    },
  });
  const createRegime = useMutation({
    mutationFn: () =>
      api.post<TaxRegimeRow>("/tax/regimes", {
        code: regimeForm.code.trim(),
        name: regimeForm.name.trim(),
        taxTypeId: regimeForm.taxTypeId,
        jurisdictionId: regimeForm.jurisdictionId,
        authorityId: regimeForm.authorityId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax-regimes", firmId] });
      setRegimeForm({
        code: "",
        name: "",
        taxTypeId: "",
        jurisdictionId: "",
        authorityId: "",
      });
      setDrawer(null);
    },
  });

  const createActivity = useMutation({
    mutationFn: () =>
      api.post<CatalogActivityRow>("/tax/activities", {
        code: normalizeActivityCode(activityForm.code),
        name: activityForm.name.trim(),
        jurisdictionId: activityForm.jurisdictionId,
        ...(activityForm.source.trim() ? { source: activityForm.source.trim() } : {}),
        validFrom: activityForm.validFrom,
        ...(activityForm.validTo ? { validTo: activityForm.validTo } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax-activities-catalog", firmId] });
      setActivityForm(emptyActivityForm);
      setActivityDrawer(null);
      setReceipt("La actividad quedó registrada en el catálogo.");
    },
  });
  // El código y la jurisdicción no se editan: son la clave con la que las
  // reglas vigentes y los vínculos de clientes resuelven el historial.
  const updateActivity = useMutation({
    mutationFn: () =>
      api.patch<CatalogActivityRow>(`/tax/activities/${editingActivity?.id ?? ""}`, {
        name: activityForm.name.trim(),
        source: activityForm.source.trim() ? activityForm.source.trim() : null,
        validFrom: activityForm.validFrom,
        ...(activityForm.validTo ? { validTo: activityForm.validTo } : { validTo: null }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax-activities-catalog", firmId] });
      setEditingActivity(null);
      setActivityForm(emptyActivityForm);
      setActivityDrawer(null);
      setReceipt("Los datos de la actividad quedaron actualizados. El código se conserva.");
    },
  });
  // No hay borrado: desactivar es la baja lógica y el historial se conserva.
  const toggleActivity = useMutation({
    mutationFn: (row: CatalogActivityRow) =>
      api.post<CatalogActivityRow & { activeClientLinks?: number }>(
        `/tax/activities/${row.id}/${row.isActive ? "deactivate" : "activate"}`,
      ),
    onSuccess: (updated, row) => {
      void queryClient.invalidateQueries({ queryKey: ["tax-activities-catalog", firmId] });
      setActivityDrawer(null);
      if (row.isActive) {
        const links = updated.activeClientLinks ?? 0;
        setReceipt(
          links > 0
            ? `La actividad quedó desactivada. Conserva ${links} ${links === 1 ? "vínculo" : "vínculos"} de clientes vigentes y las reglas históricas siguen resolviendo por código.`
            : "La actividad quedó desactivada. El registro y su historial se conservan; sólo deja de ofrecerse en los selectores.",
        );
      } else {
        setReceipt("La actividad vuelve a estar activa y se ofrece en los selectores.");
      }
    },
  });

  if (!firmId) {
    return <EmptyState title="Seleccioná un estudio" description="Elegí un estudio para consultar sus catálogos fiscales." />;
  }
  if (!capabilities.has("tax.rules.read")) {
    return <EmptyState title="Acceso restringido" description="No tenés permiso para consultar catálogos fiscales." />;
  }

  const matchingAuthorities = (authoritiesQuery.data ?? []).filter(
    (authority) => authority.jurisdictionId === regimeForm.jurisdictionId,
  );
  const failedQueries = [
    { label: "jurisdicciones", query: jurisdictionsQuery },
    { label: "impuestos", query: taxTypesQuery },
    { label: "organismos recaudadores", query: authoritiesQuery },
    { label: "regímenes", query: regimesQuery },
    { label: "actividades económicas", query: activitiesQuery },
  ].filter((item) => item.query.isError);

  const jurisdictionName = (jurisdictionId: string) => {
    const jurisdiction = jurisdictionsQuery.data?.find((item) => item.id === jurisdictionId);
    return jurisdiction ? `${jurisdiction.name} (${jurisdiction.code})` : "—";
  };
  const searchTerm = activitySearch.trim().toLowerCase();
  const visibleActivities = (activitiesQuery.data ?? []).filter(
    (row) =>
      !searchTerm ||
      row.code.toLowerCase().includes(searchTerm) ||
      row.name.toLowerCase().includes(searchTerm),
  );
  const activityCodeValid = ACTIVITY_CODE_PATTERN.test(normalizeActivityCode(activityForm.code));
  const activityValidityValid =
    !activityForm.validTo || activityForm.validFrom <= activityForm.validTo;

  return (
    <div className="study-page">
      <header className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Administración fiscal</p>
          <h1 className="study-page__title">Catálogos fiscales</h1>
          <p className="study-page__subtitle">
            Administrá organismos recaudadores, regímenes y actividades económicas para vincularlos a
            la configuración fiscal de cada cliente.
          </p>
        </div>
      </header>

      <p className="study-panel">
        Las jurisdicciones, organismos recaudadores, impuestos y actividades económicas integran los
        catálogos del estudio. Usá códigos y nombres verificados; los datos de prueba deben
        identificarse claramente como sintéticos.
      </p>

      {failedQueries.map(({ label, query }) => (
        <div className="form-error" role="alert" key={label}>
          <strong>No pudimos cargar {label}.</strong>{" "}
          <button type="button" className="fiscal-retry" onClick={() => void query.refetch()}>
            Reintentar
          </button>
        </div>
      ))}

      <section className="study-panel" aria-labelledby="tax-authorities-title">
        <div className="study-panel__heading">
          <div>
            <h2 id="tax-authorities-title">Organismos recaudadores</h2>
            <p>
              El organismo que recauda cada impuesto según la jurisdicción: ARCA en Nación (ex AFIP), la
              Dirección General de Rentas provincial (ej. DGR Tucumán) o la dirección municipal de rentas
              (ej. SMT San Miguel de Tucumán).
            </p>
          </div>
          {canPropose ? (
            <Button size="sm" onClick={() => setDrawer("authority")}>
              Nuevo organismo
            </Button>
          ) : null}
        </div>
        {authoritiesQuery.isLoading ? (
          <p className="muted-copy">Cargando organismos recaudadores…</p>
        ) : authoritiesQuery.isError ? null : (authoritiesQuery.data?.length ?? 0) === 0 ? (
          <EmptyState
            size="compact"
            title="Todavía no hay organismos recaudadores"
            description="Creá un organismo asociado a una jurisdicción para poder registrar regímenes."
          />
        ) : (
          <Table<TaxAuthorityRow>
            rows={authoritiesQuery.data ?? []}
            rowKey={(row) => row.id}
            columns={[
              { key: "code", header: "Código", render: (row) => row.code },
              { key: "name", header: "Organismo", render: (row) => row.name },
              {
                key: "jurisdiction",
                header: "Jurisdicción",
                render: (row) => `${row.jurisdiction.name} (${row.jurisdiction.code})`,
              },
            ]}
          />
        )}
      </section>

      <section className="study-panel" aria-labelledby="tax-regimes-title">
        <div className="study-panel__heading">
          <div>
            <h2 id="tax-regimes-title">Regímenes</h2>
            <p>Cada régimen requiere impuesto, jurisdicción y organismo recaudador compatibles.</p>
          </div>
          {canPropose ? (
            <Button
              size="sm"
              onClick={() => setDrawer("regime")}
              disabled={
                (jurisdictionsQuery.data?.length ?? 0) === 0 ||
                (taxTypesQuery.data?.length ?? 0) === 0 ||
                (authoritiesQuery.data?.length ?? 0) === 0
              }
            >
              Nuevo régimen
            </Button>
          ) : null}
        </div>
        {regimesQuery.isLoading ? (
          <p className="muted-copy">Cargando regímenes…</p>
        ) : regimesQuery.isError ? null : (regimesQuery.data?.length ?? 0) === 0 ? (
          <EmptyState
            size="compact"
            title="Todavía no hay regímenes fiscales"
            description="Definí un régimen con un organismo recaudador y jurisdicción verificados."
          />
        ) : (
          <Table<TaxRegimeRow>
            rows={regimesQuery.data ?? []}
            rowKey={(row) => row.id}
            columns={[
              { key: "code", header: "Código", render: (row) => row.code },
              { key: "name", header: "Régimen", render: (row) => row.name },
              { key: "taxType", header: "Impuesto", render: (row) => `${row.taxType.name} (${row.taxType.code})` },
              { key: "jurisdiction", header: "Jurisdicción", render: (row) => row.jurisdiction.name },
              { key: "authority", header: "Organismo", render: (row) => row.authority.name },
            ]}
          />
        )}
      </section>

      <section className="study-panel" aria-labelledby="tax-activities-title">
        <div className="study-panel__heading">
          <div>
            <h2 id="tax-activities-title">Actividades económicas</h2>
            <p>
              Catálogo de actividades por jurisdicción con fuente y vigencia. El código es la clave
              con la que las reglas y los vínculos de clientes resuelven el historial: no se edita ni
              se borra; la baja es lógica (desactivar) y los valores históricos siguen resolviendo.
            </p>
          </div>
          {canPropose ? (
            <Button
              size="sm"
              onClick={() => {
                setEditingActivity(null);
                setActivityForm(emptyActivityForm);
                setActivityDrawer("create");
              }}
              disabled={(jurisdictionsQuery.data?.length ?? 0) === 0}
            >
              Nueva actividad
            </Button>
          ) : null}
        </div>
        <div className="ds-field fiscal-activity-search">
          <label className="ds-field__label" htmlFor="activity-search">Buscar</label>
          <input
            id="activity-search"
            className="ds-field__input"
            type="search"
            value={activitySearch}
            onChange={(event) => setActivitySearch(event.target.value)}
            placeholder="Buscar por código o nombre…"
          />
        </div>
        {activitiesQuery.isLoading ? (
          <p className="muted-copy">Cargando actividades económicas…</p>
        ) : activitiesQuery.isError ? null : visibleActivities.length === 0 ? (
          <EmptyState
            size="compact"
            title={
              searchTerm
                ? "Ninguna actividad coincide con la búsqueda"
                : "Todavía no hay actividades económicas"
            }
            description={
              searchTerm
                ? "Probá con otro código o nombre."
                : "Creá una actividad para poder vincularla a clientes y reglas fiscales."
            }
          />
        ) : (
          <Table<CatalogActivityRow>
            rows={visibleActivities}
            rowKey={(row) => row.id}
            columns={[
              { key: "code", header: "Código", render: (row) => row.code },
              { key: "name", header: "Actividad", render: (row) => row.name },
              {
                key: "jurisdiction",
                header: "Jurisdicción",
                render: (row) => jurisdictionName(row.jurisdictionId),
              },
              {
                key: "source",
                header: "Fuente",
                render: (row) => row.source ?? "—",
              },
              {
                key: "validity",
                header: "Vigencia",
                render: (row) => `${shortDate(row.validFrom)} — ${shortDate(row.validTo)}`,
              },
              {
                key: "state",
                header: "Estado",
                render: (row) => <ActivityStateBadge isActive={row.isActive} />,
              },
              {
                key: "actions",
                header: "",
                render: (row) =>
                  canPropose ? (
                    <div className="fiscal-activity-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingActivity(row);
                          setActivityForm({
                            code: row.code,
                            name: row.name,
                            jurisdictionId: row.jurisdictionId,
                            source: row.source ?? "",
                            validFrom: row.validFrom.slice(0, 10),
                            validTo: row.validTo?.slice(0, 10) ?? "",
                          });
                          setActivityDrawer("edit");
                        }}
                      >
                        Editar
                      </Button>
                      {row.isActive ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingActivity(row);
                            setActivityDrawer("deactivate");
                          }}
                        >
                          Desactivar
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleActivity.mutate(row)}
                          loading={toggleActivity.isPending && toggleActivity.variables?.id === row.id}
                        >
                          Reactivar
                        </Button>
                      )}
                    </div>
                  ) : null,
              },
            ]}
          />
        )}
      </section>

      <ActionDrawer
        isOpen={drawer === "authority"}
        onClose={() => setDrawer(null)}
        eyebrow="Catálogo fiscal del estudio"
        title="Nuevo organismo recaudador"
        description="La jurisdicción define el alcance en el que puede asignarse este organismo: ARCA recauda en Nación, las DGR en cada provincia y las direcciones de rentas en cada municipio."
      >
        <form
          className="study-form study-form--compact"
          onSubmit={(event) => {
            event.preventDefault();
            createAuthority.mutate();
          }}
        >
          <Field
            id="authority-code"
            label="Código"
            value={authorityForm.code}
            onChange={(event) => setAuthorityForm({ ...authorityForm, code: event.target.value })}
            maxLength={40}
            required
          />
          <Field
            id="authority-name"
            label="Nombre"
            value={authorityForm.name}
            onChange={(event) => setAuthorityForm({ ...authorityForm, name: event.target.value })}
            maxLength={160}
            required
          />
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="authority-jurisdiction">Jurisdicción</label>
            <select
              id="authority-jurisdiction"
              className="ds-field__input"
              value={authorityForm.jurisdictionId}
              onChange={(event) => setAuthorityForm({ ...authorityForm, jurisdictionId: event.target.value })}
              required
            >
              <option value="">Seleccioná una jurisdicción…</option>
              {jurisdictionsQuery.data?.map((jurisdiction) => (
                <option key={jurisdiction.id} value={jurisdiction.id}>
                  {jurisdiction.name} ({jurisdiction.code})
                </option>
              ))}
            </select>
          </div>
          <MutationError error={createAuthority.error} />
          <div className="study-form__actions">
            <Button
              type="submit"
              loading={createAuthority.isPending}
              disabled={!authorityForm.code.trim() || !authorityForm.name.trim() || !authorityForm.jurisdictionId}
            >
              Crear organismo
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDrawer(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={drawer === "regime"}
        onClose={() => setDrawer(null)}
        eyebrow="Catálogo fiscal del estudio"
        title="Nuevo régimen"
        description="El organismo recaudador seleccionado debe corresponder a la jurisdicción del régimen."
      >
        <form
          className="study-form study-form--compact"
          onSubmit={(event) => {
            event.preventDefault();
            createRegime.mutate();
          }}
        >
          <Field
            id="regime-code"
            label="Código"
            value={regimeForm.code}
            onChange={(event) => setRegimeForm({ ...regimeForm, code: event.target.value })}
            maxLength={40}
            required
          />
          <Field
            id="regime-name"
            label="Nombre"
            value={regimeForm.name}
            onChange={(event) => setRegimeForm({ ...regimeForm, name: event.target.value })}
            maxLength={160}
            required
          />
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="regime-tax-type">Impuesto</label>
            <select
              id="regime-tax-type"
              className="ds-field__input"
              value={regimeForm.taxTypeId}
              onChange={(event) => setRegimeForm({ ...regimeForm, taxTypeId: event.target.value })}
              required
            >
              <option value="">Seleccioná un impuesto…</option>
              {taxTypesQuery.data?.map((taxType) => (
                <option key={taxType.id} value={taxType.id}>
                  {taxType.name} ({taxType.code})
                </option>
              ))}
            </select>
          </div>
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="regime-jurisdiction">Jurisdicción</label>
            <select
              id="regime-jurisdiction"
              className="ds-field__input"
              value={regimeForm.jurisdictionId}
              onChange={(event) => setRegimeForm({ ...regimeForm, jurisdictionId: event.target.value, authorityId: "" })}
              required
            >
              <option value="">Seleccioná una jurisdicción…</option>
              {jurisdictionsQuery.data?.map((jurisdiction) => (
                <option key={jurisdiction.id} value={jurisdiction.id}>
                  {jurisdiction.name} ({jurisdiction.code})
                </option>
              ))}
            </select>
          </div>
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="regime-authority">Organismo recaudador</label>
            <select
              id="regime-authority"
              className="ds-field__input"
              value={regimeForm.authorityId}
              onChange={(event) => setRegimeForm({ ...regimeForm, authorityId: event.target.value })}
              required
              disabled={!regimeForm.jurisdictionId}
            >
              <option value="">Seleccioná un organismo…</option>
              {matchingAuthorities.map((authority) => (
                <option key={authority.id} value={authority.id}>
                  {authority.name} ({authority.code})
                </option>
              ))}
            </select>
            {regimeForm.jurisdictionId && matchingAuthorities.length === 0 ? (
              <p className="muted-copy">Creá primero un organismo para esta jurisdicción.</p>
            ) : null}
          </div>
          <MutationError error={createRegime.error} />
          <div className="study-form__actions">
            <Button
              type="submit"
              loading={createRegime.isPending}
              disabled={
                !regimeForm.code.trim() ||
                !regimeForm.name.trim() ||
                !regimeForm.taxTypeId ||
                !regimeForm.jurisdictionId ||
                !regimeForm.authorityId
              }
            >
              Crear régimen
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDrawer(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      </ActionDrawer>

      {receipt ? (
        <div className="action-receipt action-receipt--page" role="status">
          <span>
            <strong>Actualización registrada</strong>
            <small>{receipt}</small>
          </span>
          <button type="button" aria-label="Cerrar confirmación" onClick={() => setReceipt(null)}>
            Cerrar
          </button>
        </div>
      ) : null}

      <ActionDrawer
        isOpen={activityDrawer === "create"}
        onClose={() => setActivityDrawer(null)}
        eyebrow="Catálogo de actividades"
        title="Nueva actividad económica"
        description="El código se guarda en mayúsculas y es la clave con la que las reglas fiscales y los vínculos de clientes resuelven el historial: después de crearla no se edita."
      >
        <form
          className="study-form study-form--compact"
          onSubmit={(event) => {
            event.preventDefault();
            createActivity.mutate();
          }}
        >
          <Field
            id="activity-code"
            label="Código"
            value={activityForm.code}
            onChange={(event) =>
              setActivityForm({ ...activityForm, code: event.target.value.toUpperCase() })
            }
            error={
              activityForm.code && !activityCodeValid
                ? "Usá letras, números, punto, guion, guion bajo o barra (máx. 40)."
                : undefined
            }
            hint="Ej.: CM03-02, SERV4, 462100"
            maxLength={40}
            required
          />
          <Field
            id="activity-name"
            label="Nombre"
            value={activityForm.name}
            onChange={(event) => setActivityForm({ ...activityForm, name: event.target.value })}
            maxLength={200}
            required
          />
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="activity-jurisdiction">Jurisdicción</label>
            <select
              id="activity-jurisdiction"
              className="ds-field__input"
              value={activityForm.jurisdictionId}
              onChange={(event) =>
                setActivityForm({ ...activityForm, jurisdictionId: event.target.value })
              }
              required
            >
              <option value="">Seleccioná una jurisdicción…</option>
              {jurisdictionsQuery.data?.map((jurisdiction) => (
                <option key={jurisdiction.id} value={jurisdiction.id}>
                  {jurisdiction.name} ({jurisdiction.code})
                </option>
              ))}
            </select>
          </div>
          <Field
            id="activity-source"
            label="Fuente"
            value={activityForm.source}
            onChange={(event) => setActivityForm({ ...activityForm, source: event.target.value })}
            placeholder="Opcional: norma, padrón o resolución (ej. CM03, Arba)"
            maxLength={200}
          />
          <Field
            id="activity-valid-from"
            label="Vigencia desde"
            type="date"
            value={activityForm.validFrom}
            onChange={(event) => setActivityForm({ ...activityForm, validFrom: event.target.value })}
            required
          />
          <Field
            id="activity-valid-to"
            label="Vigencia hasta"
            type="date"
            value={activityForm.validTo}
            min={activityForm.validFrom || undefined}
            onChange={(event) => setActivityForm({ ...activityForm, validTo: event.target.value })}
            hint="Opcional: dejala vacía si la vigencia no tiene fecha de cierre."
            error={
              activityValidityValid
                ? undefined
                : "La vigencia hasta no puede ser anterior a la vigencia desde."
            }
          />
          <MutationError error={createActivity.error} />
          <div className="study-form__actions">
            <Button
              type="submit"
              loading={createActivity.isPending}
              disabled={
                !activityForm.code.trim() ||
                !activityForm.name.trim() ||
                !activityForm.jurisdictionId ||
                !activityForm.validFrom ||
                !activityCodeValid ||
                !activityValidityValid
              }
            >
              Crear actividad
            </Button>
            <Button type="button" variant="ghost" onClick={() => setActivityDrawer(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={activityDrawer === "edit" && Boolean(editingActivity)}
        onClose={() => setActivityDrawer(null)}
        eyebrow="Catálogo de actividades"
        title="Editar actividad económica"
        description="El código y la jurisdicción no se editan: las reglas vigentes y los vínculos de clientes los usan como clave del historial."
      >
        {editingActivity ? (
          <form
            className="study-form study-form--compact"
            onSubmit={(event) => {
              event.preventDefault();
              updateActivity.mutate();
            }}
          >
            <div className="ds-field">
              <span className="ds-field__label">Código (no editable)</span>
              <p className="fiscal-activity-readonly-code">{editingActivity.code}</p>
            </div>
            <div className="ds-field">
              <label className="ds-field__label" htmlFor="activity-edit-jurisdiction">
                Jurisdicción (no editable)
              </label>
              <input
                id="activity-edit-jurisdiction"
                className="ds-field__input"
                value={jurisdictionName(editingActivity.jurisdictionId)}
                disabled
                readOnly
              />
            </div>
            <Field
              id="activity-edit-name"
              label="Nombre"
              value={activityForm.name}
              onChange={(event) => setActivityForm({ ...activityForm, name: event.target.value })}
              maxLength={200}
              required
            />
            <Field
              id="activity-edit-source"
              label="Fuente"
              value={activityForm.source}
              onChange={(event) => setActivityForm({ ...activityForm, source: event.target.value })}
              placeholder="Opcional: dejala vacía para quitar la fuente"
              maxLength={200}
            />
            <Field
              id="activity-edit-valid-from"
              label="Vigencia desde"
              type="date"
              value={activityForm.validFrom}
              onChange={(event) =>
                setActivityForm({ ...activityForm, validFrom: event.target.value })
              }
              required
            />
            <Field
              id="activity-edit-valid-to"
              label="Vigencia hasta"
              type="date"
              value={activityForm.validTo}
              min={activityForm.validFrom || undefined}
              onChange={(event) =>
                setActivityForm({ ...activityForm, validTo: event.target.value })
              }
              hint="Opcional: dejala vacía si la vigencia no tiene fecha de cierre."
              error={
                activityValidityValid
                  ? undefined
                  : "La vigencia hasta no puede ser anterior a la vigencia desde."
              }
            />
            <MutationError error={updateActivity.error} />
            <div className="study-form__actions">
              <Button
                type="submit"
                loading={updateActivity.isPending}
                disabled={
                  !activityForm.name.trim() ||
                  !activityForm.validFrom ||
                  !activityValidityValid
                }
              >
                Guardar cambios
              </Button>
              <Button type="button" variant="ghost" onClick={() => setActivityDrawer(null)}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : null}
      </ActionDrawer>

      <ActionDrawer
        isOpen={activityDrawer === "deactivate" && Boolean(editingActivity)}
        onClose={() => setActivityDrawer(null)}
        eyebrow="Catálogo de actividades"
        title="Desactivar actividad económica"
        description="La baja es lógica: el registro y su historial se conservan, las reglas vigentes siguen resolviendo por código y los vínculos de clientes no se invalidan. Sólo deja de ofrecerse en los selectores."
      >
        {editingActivity ? (
          <form
            className="study-form study-form--compact"
            onSubmit={(event) => {
              event.preventDefault();
              toggleActivity.mutate(editingActivity);
            }}
          >
            <p className="fiscal-activity-confirm">
              ¿Desactivamos <strong>{editingActivity.code}</strong> — {editingActivity.name}?
            </p>
            <MutationError error={toggleActivity.error} />
            <div className="study-form__actions">
              <Button type="submit" loading={toggleActivity.isPending}>
                Desactivar
              </Button>
              <Button type="button" variant="ghost" onClick={() => setActivityDrawer(null)}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : null}
      </ActionDrawer>
    </div>
  );
}
