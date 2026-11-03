import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import { useNavigate } from "react-router-dom";
import { api, type Client } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import { ActionDrawer } from "../ui/ActionDrawer";
import { Icon } from "../ui/Icon";
import { SectionIndex } from "../ui/SectionIndex";
import { StatusBadge } from "../ui/StatusBadge";
import "./study.css";

function formatCuit(cuit: string) {
  return cuit.length === 11 ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}` : cuit;
}

interface ClientProfile {
  functionalCurrency: string;
  accountingStandard: string | null;
  fiscalYearEndMonth: number;
  vatCondition: string | null;
  iibbJurisdictions: string[];
  province: string | null;
  activity: string | null;
  legalForm: string | null;
  serviceStartDate: string | null;
}

interface ClientWithProfile extends Client {
  tradeName?: string | null;
  profile?: ClientProfile | null;
}

interface ClientProfileForm {
  functionalCurrency: string;
  accountingStandard: string;
  fiscalYearEndMonth: string;
  vatCondition: string;
  iibbJurisdictions: string;
  province: string;
  activity: string;
  legalForm: string;
  serviceStartDate: string;
}

function profileFormFrom(client: ClientWithProfile): ClientProfileForm {
  const profile = client.profile;
  return {
    functionalCurrency: profile?.functionalCurrency ?? "ARS",
    accountingStandard: profile?.accountingStandard ?? "",
    fiscalYearEndMonth: String(profile?.fiscalYearEndMonth ?? 12),
    vatCondition: profile?.vatCondition ?? "",
    iibbJurisdictions: profile?.iibbJurisdictions.join(", ") ?? "",
    province: profile?.province ?? "",
    activity: profile?.activity ?? "",
    legalForm: profile?.legalForm ?? "",
    serviceStartDate: profile?.serviceStartDate?.slice(0, 10) ?? "",
  };
}

export function StudyClientes() {
  const { firmId, clientId, capabilities, setClientId } = useClientContext();
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    legalName: "",
    tradeName: "",
    cuit: "",
    province: "",
    activity: "",
    legalForm: "",
  });
  const [editingClient, setEditingClient] = useState<ClientWithProfile | null>(null);
  const [profileForm, setProfileForm] = useState<ClientProfileForm>(() => ({
    functionalCurrency: "ARS",
    accountingStandard: "",
    fiscalYearEndMonth: "12",
    vatCondition: "",
    iibbJurisdictions: "",
    province: "",
    activity: "",
    legalForm: "",
    serviceStartDate: "",
  }));
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["clients", firmId],
    queryFn: () => api.get<ClientWithProfile[]>(`/firms/${firmId}/clients`),
    enabled: Boolean(firmId),
  });
  const create = useMutation({
    mutationFn: () =>
      api.post<Client>(`/firms/${firmId}/clients`, {
        legalName: form.legalName.trim(),
        cuit: form.cuit,
        ...(form.tradeName.trim() ? { tradeName: form.tradeName.trim() } : {}),
        ...(form.province.trim() ? { province: form.province.trim() } : {}),
        ...(form.activity.trim() ? { activity: form.activity.trim() } : {}),
        ...(form.legalForm.trim() ? { legalForm: form.legalForm.trim() } : {}),
      }),
    onSuccess: async (client) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["clients", firmId] }),
        session.refresh(),
      ]);
      setClientId(client.id);
      setCreating(false);
      setForm({
        legalName: "",
        tradeName: "",
        cuit: "",
        province: "",
        activity: "",
        legalForm: "",
      });
      navigate("/configuracion-fiscal");
    },
  });
  const updateProfile = useMutation({
    mutationFn: () => {
      if (!editingClient) throw new Error("Elegí un cliente para actualizar su ficha");
      const jurisdictions = profileForm.iibbJurisdictions
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      return api.patch<ClientProfile>(`/firms/${firmId}/clients/${editingClient.id}/profile`, {
        functionalCurrency: profileForm.functionalCurrency.trim().toUpperCase(),
        fiscalYearEndMonth: Number(profileForm.fiscalYearEndMonth),
        iibbJurisdictions: jurisdictions,
        accountingStandard: profileForm.accountingStandard.trim(),
        vatCondition: profileForm.vatCondition.trim(),
        province: profileForm.province.trim(),
        activity: profileForm.activity.trim(),
        legalForm: profileForm.legalForm.trim(),
        ...(profileForm.serviceStartDate ? { serviceStartDate: profileForm.serviceStartDate } : {}),
      });
    },
    onSuccess: async () => {
      const clientName = editingClient?.legalName ?? "El cliente";
      await queryClient.invalidateQueries({ queryKey: ["clients", firmId] });
      setEditingClient(null);
      setNotice(`La ficha de ${clientName} quedó actualizada.`);
    },
  });
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es-AR");
    if (!needle) return query.data ?? [];
    return (query.data ?? []).filter(
      (client) =>
        client.legalName.toLocaleLowerCase("es-AR").includes(needle) ||
        client.cuit.includes(needle.replace(/\D/g, "")),
    );
  }, [query.data, search]);

  const openClientWorkspace = (id: string) => {
    setClientId(id);
    navigate("/trabajo");
  };

  const openClientSummary = (id: string) => {
    setClientId(id);
    navigate("/resumen-cliente");
  };

  const startProfileEdit = (client: ClientWithProfile) => {
    setCreating(false);
    setNotice(null);
    setEditingClient(client);
    setProfileForm(profileFormFrom(client));
  };

  return (
    <div className="study-page">
      <div className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Cartera del estudio</p>
          <h1 className="study-page__title">Clientes</h1>
          <p className="study-page__subtitle">
            Elegí el contexto de trabajo o incorporá una nueva empresa.
          </p>
        </div>
        {capabilities.has("client.manage") ? (
          <Button
            onClick={() => {
              setEditingClient(null);
              setCreating((value) => !value);
            }}
            variant={creating ? "secondary" : "primary"}
          >
            <Icon name={creating ? "close" : "plus"} size={17} />
            {creating ? "Cancelar" : "Nuevo cliente"}
          </Button>
        ) : null}
      </div>

      <SectionIndex
        items={[
          { id: "clients-context-title", label: "Contexto" },
          { id: "clients-next-step-title", label: "Siguiente paso" },
          { id: "client-list-title", label: "Cartera", meta: `${rows.length} clientes` },
        ]}
      />

      {notice ? (
        <div className="action-receipt action-receipt--page" role="status">
          <Icon name="check" size={18} />
          <span>
            <strong>Actualización guardada</strong>
            <small>{notice}</small>
          </span>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}>
            <Icon name="close" size={15} />
          </button>
        </div>
      ) : null}

      <section className="guided-context" aria-labelledby="clients-context-title">
        <div className="guided-context__heading"><div><p className="study-page__eyebrow">Cartera operativa</p><h2 id="clients-context-title">Contexto de clientes</h2><p>Elegí una empresa para continuar con su trabajo, documentos y configuración fiscal.</p></div><StatusBadge status={clientId ? "ACTIVE" : "PENDING"} /></div>
        <dl className="guided-context__facts"><div><dt>Clientes</dt><dd>{query.data?.length ?? "—"}</dd></div><div><dt>Contexto actual</dt><dd>{clientId ? "Seleccionado" : "Sin seleccionar"}</dd></div><div><dt>Resultados</dt><dd>{rows.length}</dd></div></dl>
      </section>
      <section className="guided-next-step" aria-labelledby="clients-next-step-title"><div><p className="study-page__eyebrow">Flujo guiado</p><h2 id="clients-next-step-title">Próximo paso</h2><p>{clientId ? "Abrí el espacio de trabajo del cliente seleccionado o completá su configuración fiscal." : "Incorporá una empresa o elegí una de la cartera para comenzar a trabajar."}</p></div>{clientId ? <Button onClick={() => navigate("/trabajo")}>Abrir trabajo</Button> : capabilities.has("client.manage") ? <Button onClick={() => setCreating(true)}>Crear cliente</Button> : null}</section>

      <ActionDrawer
        isOpen={creating}
        onClose={() => setCreating(false)}
        eyebrow="Cartera"
        title="Alta de cliente"
        description="Completá los datos fiscales básicos. La configuración fiscal completa queda como paso siguiente."
        footer={
          <Button
            type="submit"
            form="client-create-form"
            loading={create.isPending}
            loadingLabel="Creando cliente"
            disabled={form.legalName.trim().length < 2 || form.cuit.length !== 11}
          >
            Crear cliente
          </Button>
        }
      >
        <form
          id="client-create-form"
          className="study-inline-form study-inline-form--client"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Field
            id="client-legal-name"
            label="Razón social"
            value={form.legalName}
            onChange={(event) => setForm({ ...form, legalName: event.target.value })}
            maxLength={200}
            required
          />
          <Field
            id="client-trade-name"
            label="Nombre comercial"
            value={form.tradeName}
            onChange={(event) => setForm({ ...form, tradeName: event.target.value })}
            maxLength={100}
          />
          <Field
            id="client-cuit"
            label="CUIT"
            value={form.cuit}
            onChange={(event) =>
              setForm({ ...form, cuit: event.target.value.replace(/\D/g, "").slice(0, 11) })
            }
            inputMode="numeric"
            pattern="[0-9]{11}"
            hint="11 dígitos, sin guiones"
            required
          />
          <Field
            id="client-province"
            label="Provincia"
            value={form.province}
            onChange={(event) => setForm({ ...form, province: event.target.value })}
            maxLength={100}
            placeholder="Opcional"
          />
          <Field
            id="client-activity"
            label="Actividad principal"
            value={form.activity}
            onChange={(event) => setForm({ ...form, activity: event.target.value })}
            maxLength={200}
            placeholder="Opcional"
          />
          <Field
            id="client-legal-form"
            label="Forma jurídica"
            value={form.legalForm}
            onChange={(event) => setForm({ ...form, legalForm: event.target.value })}
            maxLength={100}
            placeholder="Opcional"
          />
          {create.isError ? (
            <p className="form-error study-inline-form__feedback" role="alert">
              No se pudo crear el cliente. Revisá el CUIT y los permisos.
            </p>
          ) : null}
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={Boolean(editingClient)}
        onClose={() => setEditingClient(null)}
        eyebrow="Ficha operativa"
        title={editingClient ? editingClient.legalName : "Cliente"}
        description="Estos datos se usan como base contable y fiscal. Los regímenes y alícuotas se administran en configuración fiscal."
        size="wide"
        footer={
          editingClient ? (
            <Button
              type="submit"
              form="client-profile-form"
              loading={updateProfile.isPending}
              loadingLabel="Guardando ficha"
            >
              Guardar ficha
            </Button>
          ) : null
        }
      >
        {editingClient ? (
          <form
            id="client-profile-form"
            className="study-inline-form study-inline-form--client"
            onSubmit={(event) => {
              event.preventDefault();
              updateProfile.mutate();
            }}
          >
            <Field
              id="client-profile-currency"
              label="Moneda funcional"
              value={profileForm.functionalCurrency}
              onChange={(event) =>
                setProfileForm({
                  ...profileForm,
                  functionalCurrency: event.target.value.slice(0, 3),
                })
              }
              maxLength={3}
              minLength={3}
              pattern="[A-Za-z]{3}"
              title="Ingresá el código ISO de tres letras, por ejemplo ARS"
              required
            />
            <label className="ds-field">
              <span className="ds-field__label">Cierre de ejercicio</span>
              <select
                className="ctxbar__input"
                value={profileForm.fiscalYearEndMonth}
                onChange={(event) =>
                  setProfileForm({ ...profileForm, fiscalYearEndMonth: event.target.value })
                }
              >
                {[
                  "Enero",
                  "Febrero",
                  "Marzo",
                  "Abril",
                  "Mayo",
                  "Junio",
                  "Julio",
                  "Agosto",
                  "Septiembre",
                  "Octubre",
                  "Noviembre",
                  "Diciembre",
                ].map((month, index) => (
                  <option key={month} value={index + 1}>
                    {month}
                  </option>
                ))}
              </select>
            </label>
            <Field
              id="client-profile-vat"
              label="Condición frente al IVA"
              value={profileForm.vatCondition}
              onChange={(event) =>
                setProfileForm({ ...profileForm, vatCondition: event.target.value })
              }
              maxLength={100}
              placeholder="Ej.: Responsable inscripto"
            />
            <Field
              id="client-profile-province"
              label="Provincia"
              value={profileForm.province}
              onChange={(event) => setProfileForm({ ...profileForm, province: event.target.value })}
              maxLength={100}
            />
            <Field
              id="client-profile-activity"
              label="Actividad principal"
              value={profileForm.activity}
              onChange={(event) => setProfileForm({ ...profileForm, activity: event.target.value })}
              maxLength={200}
            />
            <Field
              id="client-profile-legal-form"
              label="Forma jurídica"
              value={profileForm.legalForm}
              onChange={(event) =>
                setProfileForm({ ...profileForm, legalForm: event.target.value })
              }
              maxLength={100}
            />
            <Field
              id="client-profile-iibb"
              label="Jurisdicciones IIBB"
              value={profileForm.iibbJurisdictions}
              onChange={(event) =>
                setProfileForm({ ...profileForm, iibbJurisdictions: event.target.value })
              }
              hint="Separalas con coma"
              maxLength={500}
            />
            <Field
              id="client-profile-standard"
              label="Norma contable"
              value={profileForm.accountingStandard}
              onChange={(event) =>
                setProfileForm({ ...profileForm, accountingStandard: event.target.value })
              }
              maxLength={100}
              placeholder="Opcional"
            />
            <Field
              id="client-profile-service-start"
              label="Inicio del servicio"
              type="date"
              value={profileForm.serviceStartDate}
              onChange={(event) =>
                setProfileForm({ ...profileForm, serviceStartDate: event.target.value })
              }
            />
            {updateProfile.isError ? (
              <p className="form-error study-inline-form__feedback" role="alert">
                No se pudo guardar la ficha. Revisá los datos e intentá nuevamente.
              </p>
            ) : null}
          </form>
        ) : null}
      </ActionDrawer>

      <section className="study-page__section" aria-labelledby="client-list-title">
        <div className="collection-toolbar">
          <div>
            <h2 id="client-list-title">Cartera</h2>
            <p>
              {query.isLoading
                ? "Consultando clientes…"
                : `${rows.length} ${rows.length === 1 ? "cliente" : "clientes"}`}
            </p>
          </div>
          <label className="collection-search">
            <span className="sr-only">Buscar clientes</span>
            <Icon name="search" size={17} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre o CUIT"
            />
          </label>
        </div>
        {query.isLoading ? (
          <div className="query-state" role="status">
            <span className="loading-copy">Cargando la cartera…</span>
          </div>
        ) : query.isError ? (
          <EmptyState
            title="No se pudieron cargar los clientes"
            description="Reintentá en unos minutos o comprobá tu conexión."
            action={
              <Button variant="secondary" onClick={() => void query.refetch()}>
                Reintentar
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={search ? "No encontramos coincidencias" : "Todavía no hay clientes"}
            description={
              search
                ? "Probá con otro nombre o CUIT."
                : "Creá el primer cliente para comenzar a organizar la operación."
            }
            action={
              !search && capabilities.has("client.manage") ? (
                <Button
                  onClick={() => {
                    setEditingClient(null);
                    setCreating(true);
                  }}
                >
                  Crear cliente
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "legalName",
                header: "Cliente",
                render: (row) => (
                  <button
                    className="client-link"
                    aria-current={clientId === row.id ? "true" : undefined}
                    onClick={() => openClientWorkspace(row.id)}
                  >
                    <span className="client-link__avatar" aria-hidden="true">
                      {row.legalName.slice(0, 1).toLocaleUpperCase("es-AR")}
                    </span>
                    <span>
                      <strong>{row.legalName}</strong>
                      <small>{clientId === row.id ? "Contexto activo" : "Abrir contexto"}</small>
                    </span>
                  </button>
                ),
              },
              {
                key: "cuit",
                header: "CUIT",
                render: (row) => <span className="tabular-copy">{formatCuit(row.cuit)}</span>,
              },
              {
                key: "status",
                header: "Estado",
                render: (row) => <StatusBadge status={row.status} />,
              },
              {
                key: "action",
                header: "Acciones",
                align: "right",
                render: (row) => (
                  <div className="table-actions">
                    {capabilities.has("client.manage") ? (
                      <Button size="sm" variant="ghost" onClick={() => startProfileEdit(row)}>
                        Editar ficha
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => openClientSummary(row.id)}>
                      Resumen
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openClientWorkspace(row.id)}
                    >
                      Abrir <Icon name="arrow-right" size={15} />
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </section>
    </div>
  );
}
