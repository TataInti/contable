import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
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
  ].filter((item) => item.query.isError);

  return (
    <div className="study-page">
      <header className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Administración fiscal</p>
          <h1 className="study-page__title">Catálogos fiscales</h1>
          <p className="study-page__subtitle">
            Administrá organismos recaudadores y regímenes para vincularlos a la configuración fiscal de cada cliente.
          </p>
        </div>
      </header>

      <p className="study-panel">
        Las jurisdicciones, organismos recaudadores e impuestos integran los catálogos del estudio. Usá códigos y nombres verificados; los datos de prueba deben identificarse claramente como sintéticos.
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
    </div>
  );
}
