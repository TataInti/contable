import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  EmptyState,
  Field,
  Notice,
  useNotify,
} from "@contable/design-system";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ARGENTINA_PROVINCES,
  BACKED_CURRENCIES,
  CLIENT_LEGAL_FORMS,
  CLIENT_VAT_CONDITION_LABELS,
  CLIENT_VAT_CONDITIONS,
  clientEconomicActivityValue,
  matchAccountingStandards,
  matchIibbJurisdictions,
  type CatalogJurisdiction,
  type ClientEconomicActivityOption,
} from "@contable/contracts";
import { ApiError, api, type Client, type ClientContact } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import { ActionDrawer } from "../ui/ActionDrawer";
import { DeletionDrawer, type DeletionResult } from "../ui/DeletionDrawer";
import { Icon } from "../ui/Icon";
import {
  DenseFooter,
  DenseHeader,
  DenseLoading,
  DensePage,
  DenseTable,
  DenseWorkspace,
  StatStrip,
  useDenseShortcuts,
  useDensity,
} from "../ui/Dense";
import "./study.css";
import { InspectorCliente } from "./clientes/InspectorCliente";
import { columnasCartera } from "./clientes/ColumnasCartera";
import { FiltrosCartera, hasActiveFilters } from "./clientes/FiltrosCartera";
import { profileGaps } from "./clientes/etiquetas";
import { profileFormFrom } from "./clientes/tipos";
import type {
  AccountingStandardCatalogEntry,
  ClientContactForm,
  ClientProfile,
  ClientProfileForm,
  ClientWithProfile,
  ContactRetryTarget,
} from "./clientes/tipos";
import { endingGroup, parseEndingFilter } from "./clientes/terminacion";


export function StudyClientes() {
  const { firmId, clientId, capabilities, setClientId } = useClientContext();
  const session = useSession();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [vatFilter, setVatFilter] = useState("");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const endingParam = searchParams.get("terminacion");
  const endingFilter = useMemo(() => parseEndingFilter(endingParam), [endingParam]);
  const grouped = searchParams.get("agrupar") === "terminacion";
  const updateUrl = (change: (params: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    change(next);
    setSearchParams(next, { replace: true });
  };
  const setEndingFilter = (digits: string[]) =>
    updateUrl((params) => (digits.length > 0 ? params.set("terminacion", digits.join(",")) : params.delete("terminacion")));
  const setGrouping = (on: boolean) =>
    updateUrl((params) => (on ? params.set("agrupar", "terminacion") : params.delete("agrupar")));
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("");
    setVatFilter("");
    setOnlyIncomplete(false);
    setEndingFilter([]);
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [density] = useDensity();
  const searchRef = useRef<HTMLInputElement>(null);
  const [identityForm, setIdentityForm] = useState({
    legalName: "",
    tradeName: "",
    cuit: "",
  });
  const [statusClient, setStatusClient] = useState<ClientWithProfile | null>(null);
  const [statusForm, setStatusForm] = useState("ONBOARDING");
  const [contactEditorOpen, setContactEditorOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ClientContact | null>(null);
  const [contactForm, setContactForm] = useState<ClientContactForm>({
    name: "",
    function: "",
    email: "",
    phone: "",
    isPrimary: false,
  });
  const [form, setForm] = useState({
    legalName: "",
    tradeName: "",
    cuit: "",
    contactEmail: "",
    vatCondition: "",
    province: "",
    activity: "",
    legalForm: "",
  });
  const [editingClient, setEditingClient] = useState<ClientWithProfile | null>(null);
  const [deletingClient, setDeletingClient] = useState<ClientWithProfile | null>(null);
  const [profileForm, setProfileForm] = useState<ClientProfileForm>(() => ({
    functionalCurrency: "ARS",
    accountingStandard: "",
    fiscalYearEndMonth: "12",
    vatCondition: "",
    iibbJurisdictions: null,
    province: "",
    activity: "",
    legalForm: "",
    serviceStartDate: "",
  }));
  const notify = useNotify();
  const [contactRetry, setContactRetry] = useState<ContactRetryTarget | null>(null);
  const query = useQuery({
    queryKey: ["clients", firmId],
    queryFn: () => api.get<ClientWithProfile[]>(`/firms/${firmId}/clients`),
    enabled: Boolean(firmId),
  });
  const contactsQuery = useQuery({
    queryKey: ["client-contacts", firmId, selectedId],
    queryFn: () => {
      if (!firmId || !selectedId) return Promise.resolve([]);
      return api.get<ClientContact[]>(`/firms/${firmId}/clients/${selectedId}/contacts`);
    },
    enabled: Boolean(firmId && selectedId && capabilities.has("client.manage")),
  });
  const jurisdictionCatalog = useQuery({
    queryKey: ["jurisdiction-catalog", firmId],
    queryFn: () => api.get<(CatalogJurisdiction & { isActive: boolean })[]>("/tax/jurisdictions?includeInactive=true"),
    enabled: Boolean(firmId),
  });
  const clientActivityCatalog = useQuery({
    queryKey: ["client-profile-activity-catalog", firmId],
    queryFn: () =>
      api.get<ClientEconomicActivityOption[]>(
        `/firms/${firmId}/client-profile-catalogs/activities`,
      ),
    enabled: Boolean(firmId),
  });
  // Catálogo de normas contables definido por el estudio en Administración.
  // Se piden activas e inactivas: los valores guardados inactivos se
  // conservan como opción (desactivar una norma no invalida fichas).
  const accountingStandardsCatalog = useQuery({
    queryKey: ["accounting-standards", firmId],
    queryFn: () =>
      api.get<AccountingStandardCatalogEntry[]>(`/firms/${firmId}/accounting-standards`),
    enabled: Boolean(firmId),
  });
  // Catálogo y matching derivados: mientras el usuario no toca los checkboxes,
  // la selección viene de lo guardado + catálogo (preserva datos existentes).
  const catalogData = jurisdictionCatalog.data;
  const activityEntries = clientActivityCatalog.data ?? [];
  const activeActivityEntries = activityEntries.filter((entry) => entry.isActive !== false);
  const allActivityValues = new Set(activityEntries.map(clientEconomicActivityValue));
  const activeActivityValues = new Set(activeActivityEntries.map(clientEconomicActivityValue));
  const jurisdictionMatch = useMemo(
    () =>
      matchIibbJurisdictions(
        catalogData ?? [],
        editingClient?.profile?.iibbJurisdictions ?? [],
      ),
    [catalogData, editingClient],
  );
  const selectedJurisdictions = profileForm.iibbJurisdictions ?? jurisdictionMatch.canonical;
  const outOfCatalogJurisdictions = jurisdictionMatch.unknown;
  const toggleJurisdiction = (code: string, checked: boolean) => {
    setProfileForm({
      ...profileForm,
      iibbJurisdictions: checked
        ? [...new Set([...selectedJurisdictions, code])]
        : selectedJurisdictions.filter((value) => value !== code),
    });
  };
  const currencyNotBacked = !(BACKED_CURRENCIES as readonly string[]).includes(
    profileForm.functionalCurrency,
  );
  // Norma contable: selección contra el catálogo del estudio (sin texto libre).
  // El valor guardado siempre está en el selector: si quedó desactivado se
  // muestra marcado como tal; si no existe en el catálogo se muestra como
  // "fuera de catálogo" y el guardado queda bloqueado hasta reelegir — nunca
  // se elimina en silencio.
  const standardCatalog = accountingStandardsCatalog.data ?? [];
  const selectedStandard = profileForm.accountingStandard.trim();
  const selectedStandardMatch = useMemo(
    () => matchAccountingStandards(standardCatalog, selectedStandard ? [selectedStandard] : []),
    [standardCatalog, selectedStandard],
  );
  const standardValue = selectedStandardMatch.canonical[0] ?? selectedStandard;
  const selectedStandardEntry = standardCatalog.find((entry) => entry.name === standardValue);
  const standardCatalogUnavailable = accountingStandardsCatalog.isError;
  const standardUnknown =
    !accountingStandardsCatalog.isLoading &&
    !standardCatalogUnavailable &&
    selectedStandard !== "" &&
    !selectedStandardEntry;
  const vatConditionIsLegacy =
    profileForm.vatCondition !== "" &&
    !(CLIENT_VAT_CONDITIONS as readonly string[]).includes(profileForm.vatCondition);
  const provinceIsLegacy =
    profileForm.province !== "" &&
    !(ARGENTINA_PROVINCES as readonly string[]).includes(profileForm.province);
  const legalFormIsLegacy =
    profileForm.legalForm !== "" &&
    !(CLIENT_LEGAL_FORMS as readonly string[]).includes(profileForm.legalForm);
  const activityIsLegacy = profileForm.activity !== "" && !allActivityValues.has(profileForm.activity);
  const activityIsInactive =
    profileForm.activity !== "" &&
    allActivityValues.has(profileForm.activity) &&
    !activeActivityValues.has(profileForm.activity);
  const create = useMutation({
    mutationFn: (submittedForm: typeof form) =>
      api.post<Client>(`/firms/${firmId}/clients`, {
        legalName: submittedForm.legalName.trim(),
        cuit: submittedForm.cuit,
        ...(submittedForm.tradeName.trim() ? { tradeName: submittedForm.tradeName.trim() } : {}),
        ...(submittedForm.vatCondition ? { vatCondition: submittedForm.vatCondition } : {}),
        ...(submittedForm.province ? { province: submittedForm.province } : {}),
        ...(submittedForm.activity ? { activity: submittedForm.activity } : {}),
        ...(submittedForm.legalForm ? { legalForm: submittedForm.legalForm } : {}),
      }),
    onSuccess: async (client, submittedForm) => {
      const email = submittedForm.contactEmail.trim();
      let contactFailed = false;
      if (email && firmId) {
        const target = {
          firmId,
          clientId: client.id,
          legalName: submittedForm.legalName.trim(),
          email,
        };
        try {
          await api.post<ClientContact>(`/firms/${firmId}/clients/${client.id}/contacts`, {
            name: target.legalName,
            email: target.email,
            isPrimary: true,
          });
          await queryClient.invalidateQueries({ queryKey: ["client-contacts", firmId, client.id] });
          setContactRetry(null);
        } catch {
          contactFailed = true;
          setContactRetry(target);
        }
      } else {
        setContactRetry(null);
      }
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
        contactEmail: "",
        vatCondition: "",
        province: "",
        activity: "",
        legalForm: "",
      });
      if (!contactFailed) navigate("/configuracion-fiscal");
    },
  });
  const retryContact = useMutation({
    mutationFn: async (target: ContactRetryTarget) => {
      const path = `/firms/${target.firmId}/clients/${target.clientId}/contacts`;
      const contacts = await api.get<ClientContact[]>(path);
      const normalizedEmail = target.email.trim().toLocaleLowerCase("en");
      const alreadyRegistered = contacts.some(
        (contact) =>
          contact.isActive &&
          contact.isPrimary &&
          contact.email?.trim().toLocaleLowerCase("en") === normalizedEmail,
      );
      if (alreadyRegistered) return null;
      return api.post<ClientContact>(path, {
        name: target.legalName,
        email: target.email,
        isPrimary: true,
      });
    },
    onSuccess: async (_contact, target) => {
      await queryClient.invalidateQueries({
        queryKey: ["client-contacts", target.firmId, target.clientId],
      });
      setContactRetry(null);
      navigate("/configuracion-fiscal");
    },
  });
  const updateProfile = useMutation({
    mutationFn: () => {
      if (!editingClient) throw new Error("Elegí un cliente para actualizar su ficha");
      return api.patch<ClientProfile>(`/firms/${firmId}/clients/${editingClient.id}/profile`, {
        functionalCurrency: profileForm.functionalCurrency.trim().toUpperCase(),
        fiscalYearEndMonth: Number(profileForm.fiscalYearEndMonth),
        // Solo códigos canónicos del catálogo fiscal; los valores guardados
        // fuera de catálogo no se envían (se avisan antes de guardar).
        iibbJurisdictions: selectedJurisdictions,
        // Selector alimentado por el catálogo del estudio: se envía el nombre
        // canónico del catálogo, nunca texto libre.
        accountingStandard: standardValue,
        vatCondition: profileForm.vatCondition,
        province: profileForm.province,
        activity: profileForm.activity,
        legalForm: profileForm.legalForm,
        ...(profileForm.serviceStartDate ? { serviceStartDate: profileForm.serviceStartDate } : {}),
      });
    },
  });
  const updateIdentity = useMutation({
    mutationFn: () => {
      if (!editingClient) throw new Error("Elegí un cliente para actualizar su identidad");
      return api.patch<Client>(`/firms/${firmId}/clients/${editingClient.id}`, {
        legalName: identityForm.legalName.trim(),
        tradeName: identityForm.tradeName.trim() || null,
        cuit: identityForm.cuit,
      });
    },
  });
  const updateStatus = useMutation({
    mutationFn: () => {
      if (!statusClient) throw new Error("Elegí un cliente para cambiar su estado");
      return api.patch<Client>(`/firms/${firmId}/clients/${statusClient.id}`, {
        status: statusForm,
      });
    },
    onSuccess: async (client) => {
      await queryClient.invalidateQueries({ queryKey: ["clients", firmId] });
      setStatusClient(null);
      notify.success(`El estado de ${client.legalName} se actualizó.`);
    },
  });
  const saveContact = useMutation({
    mutationFn: () => {
      if (!firmId || !selectedId) throw new Error("Elegí un cliente para administrar contactos");
      const path = `/firms/${firmId}/clients/${selectedId}/contacts`;
      const payload = {
        name: contactForm.name.trim(),
        function: contactForm.function.trim() || null,
        email: contactForm.email.trim() || null,
        phone: contactForm.phone.trim() || null,
        isPrimary: contactForm.isPrimary,
      };
      return editingContact
        ? api.patch<ClientContact>(`${path}/${editingContact.id}`, payload)
        : api.post<ClientContact>(path, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["client-contacts", firmId, selectedId] });
      setContactEditorOpen(false);
      setEditingContact(null);
    },
  });
  const toggleContactState = useMutation({
    mutationFn: (contact: ClientContact) => {
      if (!firmId || !selectedId) throw new Error("Elegí un cliente para administrar contactos");
      return api.patch<ClientContact>(
        `/firms/${firmId}/clients/${selectedId}/contacts/${contact.id}`,
        { isActive: !contact.isActive },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["client-contacts", firmId, selectedId] });
    },
    onError: (error) =>
      notify.error(
        error instanceof ApiError
          ? error.message
          : "No se pudo actualizar el contacto. Revisá los datos e intentá nuevamente.",
      ),
  });
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es-AR");
    const digits = needle.replace(/\D/g, "");
    return (query.data ?? []).filter((client) => {
      if (statusFilter === "ACTIVE" && client.status !== "ACTIVE") return false;
      if (statusFilter === "INACTIVE" && client.status === "ACTIVE") return false;
      if (vatFilter && client.profile?.vatCondition !== vatFilter) return false;
      if (onlyIncomplete && profileGaps(client).length === 0) return false;
      if (endingFilter.length > 0 && (client.cuitEnding == null || !endingFilter.includes(client.cuitEnding))) return false;
      if (!needle) return true;
      return (
        client.legalName.toLocaleLowerCase("es-AR").includes(needle) ||
        (client.tradeName ?? "").toLocaleLowerCase("es-AR").includes(needle) ||
        (digits !== "" && client.cuit.includes(digits))
      );
    });
  }, [query.data, search, statusFilter, vatFilter, onlyIncomplete, endingFilter]);

  const openClientWorkspace = (id: string) => {
    setClientId(id);
    navigate("/trabajo");
  };

  const openClientSummary = (id: string) => {
    setClientId(id);
    navigate("/resumen-cliente");
  };

  const startClientEdit = (client: ClientWithProfile) => {
    setCreating(false);
    updateIdentity.reset();
    updateProfile.reset();
    setEditingClient(client);
    setIdentityForm({
      legalName: client.legalName,
      tradeName: client.tradeName ?? "",
      cuit: client.cuit,
    });
    setProfileForm(profileFormFrom(client));
  };

  const startStatusChange = (client: ClientWithProfile) => {
    updateStatus.reset();
    setStatusClient(client);
    setStatusForm(client.status);
  };

  const submitClientEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingClient) return;

    const clientName = editingClient.legalName;
    const results = await Promise.allSettled([
      updateIdentity.mutateAsync(),
      updateProfile.mutateAsync(),
    ]);
    await queryClient.invalidateQueries({ queryKey: ["clients", firmId] });
    if (results.every((result) => result.status === "fulfilled")) {
      setEditingClient(null);
      notify.success(`La ficha de ${clientName} quedó actualizada.`);
    }
  };

  const openContactEditor = (contact?: ClientContact) => {
    saveContact.reset();
    setEditingContact(contact ?? null);
    setContactForm({
      name: contact?.name ?? "",
      function: contact?.function ?? "",
      email: contact?.email ?? "",
      phone: contact?.phone ?? "",
      isPrimary: contact?.isPrimary ?? false,
    });
    setContactEditorOpen(true);
  };

  const closeContactEditor = () => {
    setContactEditorOpen(false);
    setEditingContact(null);
    saveContact.reset();
  };

  const clients = query.data ?? [];
  const missingProfileFields = (client: ClientWithProfile) => profileGaps(client);
  const incompleteCount = clients.filter((client) => missingProfileFields(client).length > 0).length;
  const activeCount = clients.filter((client) => client.status === "ACTIVE").length;
  const selectedClient = selectedId ? (clients.find((client) => client.id === selectedId) ?? null) : null;
  const canManage = capabilities.has("client.manage");
  const inspectorOpen = Boolean(selectedClient);
  const missingCreateFields = [
    ...(form.legalName.trim().length < 2 ? ["razón social"] : []),
    ...(form.cuit.length !== 11 ? ["CUIT"] : []),
  ];
  const createFieldsHint = missingCreateFields.length > 0
    ? `Falta completar ${missingCreateFields.length} ${missingCreateFields.length === 1 ? "campo" : "campos"}: ${missingCreateFields.join(" y ")}.`
    : "Los datos requeridos están completos.";

  const openNew = () => {
    setEditingClient(null);
    setCreating(true);
  };
  const newRef = useRef(openNew);
  newRef.current = openNew;
  useDenseShortcuts({
    searchRef,
    onNew: canManage ? () => newRef.current() : undefined,
    onEscape: () => setSelectedId(null),
  });
  useEffect(() => {
    if (selectedId && query.data && !query.data.some((client) => client.id === selectedId)) {
      setSelectedId(null);
    }
  }, [query.data, selectedId]);
  const contactClientId = (location.state as { contactClientId?: unknown } | null)?.contactClientId;
  useEffect(() => {
    if (
      typeof contactClientId === "string" &&
      query.data?.some((client) => client.id === contactClientId)
    ) {
      setSelectedId(contactClientId);
    }
  }, [contactClientId, query.data]);

  const columns = columnasCartera({ inspectorOpen, clientId, openClientWorkspace, openClientSummary });

  const inspector = selectedClient ? (
    <InspectorCliente
      selectedClient={selectedClient}
      capabilities={capabilities}
      canManage={canManage}
      contactsQuery={contactsQuery}
      toggleContactState={toggleContactState}
      openContactEditor={openContactEditor}
      startClientEdit={startClientEdit}
      startStatusChange={startStatusChange}
      openClientSummary={openClientSummary}
      openClientWorkspace={openClientWorkspace}
      setDeletingClient={setDeletingClient}
      setSelectedId={setSelectedId}
    />
  ) : null;

  const tableBody = query.isLoading ? (
    <DenseLoading label="Cargando la cartera…" />
  ) : query.isError ? (
    <Notice
      tone="error"
      title="No se pudieron cargar los clientes"
      action={
        <Button variant="secondary" onClick={() => void query.refetch()}>
          Reintentar
        </Button>
      }
    >
      Reintentá en unos minutos o comprobá tu conexión.
    </Notice>
  ) : (
    <DenseTable<ClientWithProfile>
      label="Cartera de clientes"
      groupBy={grouped ? endingGroup : undefined}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      selectedKey={selectedId}
      onSelect={setSelectedId}
      inspectorOpen={Boolean(inspector)}
      rowClassName={(row) => (row.status === "ACTIVE" ? undefined : "dense-row--muted")}
      footer={
        <DenseFooter
          count={rows.length}
          noun={rows.length === 1 ? "cliente" : "clientes"}
          hint="Elegí una fila para ver la ficha y sus acciones."
          newShortcut={canManage}
        />
      }
      empty={
        <EmptyState
          size="compact"
          kind={clients.length === 0 ? "no-data" : "no-results"}
          title={clients.length === 0 ? "Todavía no hay clientes" : "Ningún cliente coincide"}
          description={
            clients.length === 0
              ? "Creá el primer cliente para comenzar a organizar la operación."
              : "Probá con otro nombre o CUIT, o quitá filtros."
          }
          action={
            clients.length === 0 && canManage ? (
              <Button size="sm" onClick={openNew}>
                Crear cliente
              </Button>
            ) : clients.length > 0 && hasActiveFilters({ search, statusFilter, vatFilter, onlyIncomplete, endingFilter }) ? (
              <Button size="sm" variant="secondary" onClick={clearFilters}>
                Quitar filtros
              </Button>
            ) : undefined
          }
        />
      }
    />
  );

  return (
    <DensePage density={density}>
      <DenseHeader
        title="Clientes"
        description="Elegí el contexto de trabajo o incorporá una nueva empresa."
        actions={
          canManage ? (
            <Button size="sm" onClick={openNew}>
              <Icon name="plus" size={16} /> Nuevo cliente
            </Button>
          ) : undefined
        }
      />

      <StatStrip
        label="Resumen de la cartera"
        items={[
          { key: "total", label: "Clientes", value: query.data ? clients.length : "—" },
          {
            key: "active",
            label: "Activos",
            value: query.data ? activeCount : "—",
            detail: query.data ? `${clients.length - activeCount} inactivos` : undefined,
            active: statusFilter === "ACTIVE",
            onSelect: () => setStatusFilter((current) => (current === "ACTIVE" ? "" : "ACTIVE")),
          },
          {
            key: "incomplete",
            label: "Ficha incompleta",
            value: query.data ? incompleteCount : "—",
            detail: "Faltan datos fiscales",
            tone: incompleteCount > 0 ? "warn" : undefined,
            active: onlyIncomplete,
            onSelect: () => setOnlyIncomplete((current) => !current),
          },
        ]}
      />

      {contactRetry ? (
        <Notice
          tone="error"
          className="ds-notice--page"
          action={
            <Button
              size="sm"
              variant="secondary"
              loading={retryContact.isPending}
              loadingLabel="Reintentando correo"
              onClick={() => retryContact.mutate(contactRetry)}
            >
              Reintentar
            </Button>
          }
        >
          Cliente creado. El correo no se pudo registrar; podés agregarlo desde Contactos.
        </Notice>
      ) : null}

      <FiltrosCartera
        search={search}
        setSearch={setSearch}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        vatFilter={vatFilter}
        setVatFilter={setVatFilter}
        endingFilter={endingFilter}
        setEndingFilter={setEndingFilter}
        grouped={grouped}
        setGrouping={setGrouping}
        searchRef={searchRef}
      />

      <DenseWorkspace panelId="clients-panel" inspector={inspector}>
        {tableBody}
      </DenseWorkspace>

      <ActionDrawer
        isOpen={creating}
        onClose={() => setCreating(false)}
        title="Alta de cliente"
        description="Completá los datos fiscales básicos. La configuración fiscal completa queda como paso siguiente."
        footer={
          <>
            <span id="client-create-hint" className="client-create__hint" aria-live="polite">
              {createFieldsHint}
            </span>
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="client-create-form"
              aria-describedby="client-create-hint"
              loading={create.isPending}
              loadingLabel="Creando cliente"
              disabled={missingCreateFields.length > 0}
            >
              Crear cliente
            </Button>
          </>
        }
      >
        <form
          id="client-create-form"
          className="study-inline-form study-inline-form--client client-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ ...form });
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
            id="client-create-contact-email"
            label="Correo de contacto"
            type="email"
            value={form.contactEmail}
            onChange={(event) => setForm({ ...form, contactEmail: event.target.value })}
            autoComplete="email"
            maxLength={254}
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
          <label className="ds-field">
            <span className="ds-field__label">Condición frente al IVA</span>
            <select
              id="client-vat-condition"
              className="ctxbar__input"
              value={form.vatCondition}
              onChange={(event) => setForm({ ...form, vatCondition: event.target.value })}
            >
              <option value="">Sin especificar</option>
              {CLIENT_VAT_CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {CLIENT_VAT_CONDITION_LABELS[condition]}
                </option>
              ))}
            </select>
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Provincia</span>
            <select
              id="client-province"
              className="ctxbar__input"
              value={form.province}
              onChange={(event) => setForm({ ...form, province: event.target.value })}
            >
              <option value="">Sin especificar</option>
              {ARGENTINA_PROVINCES.map((province) => (
                <option key={province} value={province}>{province}</option>
              ))}
            </select>
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Actividad principal</span>
            <select
              id="client-activity"
              className="ctxbar__input"
              value={form.activity}
              onChange={(event) => setForm({ ...form, activity: event.target.value })}
            >
              <option value="">Sin especificar</option>
              {activeActivityEntries.map((activity) => {
                const value = clientEconomicActivityValue(activity);
                return <option key={`${activity.code}:${activity.name}`} value={value}>{value}</option>;
              })}
            </select>
            {clientActivityCatalog.isLoading ? <small>Cargando catálogo de actividades…</small> : null}
          </label>
          {clientActivityCatalog.isError ? (
            <Notice tone="error">No se pudo cargar el catálogo de actividades. Reintentá.</Notice>
          ) : null}
          <label className="ds-field">
            <span className="ds-field__label">Forma jurídica</span>
            <select
              id="client-legal-form"
              className="ctxbar__input"
              value={form.legalForm}
              onChange={(event) => setForm({ ...form, legalForm: event.target.value })}
            >
              <option value="">Sin especificar</option>
              {CLIENT_LEGAL_FORMS.map((legalForm) => (
                <option key={legalForm} value={legalForm}>{legalForm}</option>
              ))}
            </select>
          </label>
          {create.isError ? (
            <Notice tone="error" className="study-inline-form__feedback">
              {create.error instanceof ApiError
                ? create.error.message
                : "No se pudo crear el cliente. Revisá los datos y los permisos."}
            </Notice>
          ) : null}
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={Boolean(editingClient)}
        onClose={() => {
          setEditingClient(null);
          updateIdentity.reset();
          updateProfile.reset();
        }}
        title="Editar cliente"
        description="Actualizá la identidad y los datos fiscales del cliente."
        size="wide"
        footer={
          editingClient ? (
            <Button
              type="submit"
              form="client-edit-form"
              loading={updateIdentity.isPending || updateProfile.isPending}
              loadingLabel="Guardando cambios"
              disabled={
                identityForm.legalName.trim().length === 0 ||
                identityForm.cuit.length !== 11 ||
                currencyNotBacked ||
                standardUnknown
              }
            >
              Guardar cambios
            </Button>
          ) : null
        }
      >
        {editingClient ? (
          <form
            id="client-edit-form"
            className="study-inline-form study-inline-form--client client-edit-form"
            onSubmit={submitClientEdit}
          >
            <section className="client-edit__section" aria-labelledby="client-edit-identity-title">
              <h3 id="client-edit-identity-title">Identidad</h3>
              <Field
                id="client-identity-legal-name"
                label="Razón social"
                value={identityForm.legalName}
                onChange={(event) => setIdentityForm({ ...identityForm, legalName: event.target.value })}
                maxLength={200}
                required
              />
              <Field
                id="client-identity-trade-name"
                label="Nombre comercial"
                value={identityForm.tradeName}
                onChange={(event) => setIdentityForm({ ...identityForm, tradeName: event.target.value })}
                maxLength={100}
              />
              <Field
                id="client-identity-cuit"
                label="CUIT"
                value={identityForm.cuit}
                onChange={(event) =>
                  setIdentityForm({
                    ...identityForm,
                    cuit: event.target.value.replace(/\D/g, "").slice(0, 11),
                  })
                }
                inputMode="numeric"
                pattern="[0-9]{11}"
                hint="11 dígitos, sin guiones"
                error={
                  updateIdentity.error instanceof ApiError &&
                  updateIdentity.error.code === "CLIENT_CUIT_CONFLICT"
                    ? updateIdentity.error.message
                    : undefined
                }
                required
              />
              {updateIdentity.isError &&
              !(updateIdentity.error instanceof ApiError &&
                updateIdentity.error.code === "CLIENT_CUIT_CONFLICT") ? (
                <Notice tone="error" className="study-inline-form__feedback">
                  {updateIdentity.error instanceof ApiError
                    ? updateIdentity.error.message
                    : "No se pudo guardar la identidad. Revisá los datos y los permisos."}
                </Notice>
              ) : null}
            </section>
            <section className="client-edit__section" aria-labelledby="client-edit-fiscal-title">
              <h3 id="client-edit-fiscal-title">Datos fiscales</h3>
            <label className="ds-field">
              <span className="ds-field__label">Moneda funcional</span>
              <select
                id="client-profile-currency"
                className="ctxbar__input"
                value={profileForm.functionalCurrency}
                onChange={(event) =>
                  setProfileForm({ ...profileForm, functionalCurrency: event.target.value })
                }
                required
              >
                {BACKED_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
                {currencyNotBacked ? (
                  <option value={profileForm.functionalCurrency}>
                    {profileForm.functionalCurrency} — fuera de catálogo
                  </option>
                ) : null}
              </select>
            </label>
            {currencyNotBacked ? (
              <Notice tone="warning">
                La moneda guardada no está respaldada por el sistema. Elegí {BACKED_CURRENCIES.join(" o ")} para guardar la ficha.
              </Notice>
            ) : null}
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
            <label className="ds-field">
              <span className="ds-field__label">Condición frente al IVA</span>
              <select
                id="client-profile-vat"
                className="ctxbar__input"
                value={profileForm.vatCondition}
                onChange={(event) =>
                  setProfileForm({ ...profileForm, vatCondition: event.target.value })
                }
              >
                <option value="">Sin especificar</option>
                {CLIENT_VAT_CONDITIONS.map((condition) => (
                  <option key={condition} value={condition}>
                    {CLIENT_VAT_CONDITION_LABELS[condition]}
                  </option>
                ))}
                {vatConditionIsLegacy ? (
                  <option value={profileForm.vatCondition}>
                    {profileForm.vatCondition} — valor histórico (conservado)
                  </option>
                ) : null}
              </select>
              {vatConditionIsLegacy ? (
                <small className="study-legacy-note">
                  El valor histórico sigue visible y se conserva si no lo reemplazás.
                </small>
              ) : null}
            </label>
            <label className="ds-field">
              <span className="ds-field__label">Provincia</span>
              <select
                id="client-profile-province"
                className="ctxbar__input"
                value={profileForm.province}
                onChange={(event) => setProfileForm({ ...profileForm, province: event.target.value })}
              >
                <option value="">Sin especificar</option>
                {ARGENTINA_PROVINCES.map((province) => (
                  <option key={province} value={province}>{province}</option>
                ))}
                {provinceIsLegacy ? (
                  <option value={profileForm.province}>
                    {profileForm.province} — valor histórico (conservado)
                  </option>
                ) : null}
              </select>
              {provinceIsLegacy ? (
                <small className="study-legacy-note">
                  El valor histórico sigue visible y se conserva si no lo reemplazás.
                </small>
              ) : null}
            </label>
            <label className="ds-field">
              <span className="ds-field__label">Actividad principal</span>
              <select
                id="client-profile-activity"
                className="ctxbar__input"
                value={profileForm.activity}
                onChange={(event) => setProfileForm({ ...profileForm, activity: event.target.value })}
              >
                <option value="">Sin especificar</option>
                {activeActivityEntries.map((activity) => {
                  const value = clientEconomicActivityValue(activity);
                  return <option key={`${activity.code}:${activity.name}`} value={value}>{value}</option>;
                })}
                {activityIsInactive ? (
                  <option value={profileForm.activity} disabled>
                    {profileForm.activity} — (oculto) en el catálogo (conservado)
                  </option>
                ) : null}
                {activityIsLegacy ? (
                  <option value={profileForm.activity}>
                    {profileForm.activity} — valor histórico (conservado)
                  </option>
                ) : null}
              </select>
              {clientActivityCatalog.isLoading ? <small>Cargando catálogo de actividades…</small> : null}
              {activityIsLegacy || activityIsInactive ? (
                <small className="study-legacy-note">
                  El valor guardado sigue visible y se conserva si no lo reemplazás.
                </small>
              ) : null}
            </label>
            {clientActivityCatalog.isError ? (
              <Notice tone="error">No se pudo cargar el catálogo de actividades. Reintentá.</Notice>
            ) : null}
            <label className="ds-field">
              <span className="ds-field__label">Forma jurídica</span>
              <select
                id="client-profile-legal-form"
                className="ctxbar__input"
                value={profileForm.legalForm}
                onChange={(event) =>
                  setProfileForm({ ...profileForm, legalForm: event.target.value })
                }
              >
                <option value="">Sin especificar</option>
                {CLIENT_LEGAL_FORMS.map((legalForm) => (
                  <option key={legalForm} value={legalForm}>{legalForm}</option>
                ))}
                {legalFormIsLegacy ? (
                  <option value={profileForm.legalForm}>
                    {profileForm.legalForm} — valor histórico (conservado)
                  </option>
                ) : null}
              </select>
              {legalFormIsLegacy ? (
                <small className="study-legacy-note">
                  El valor histórico sigue visible y se conserva si no lo reemplazás.
                </small>
              ) : null}
            </label>
            <fieldset className="ds-field" id="client-profile-iibb">
              <legend className="ds-field__label">Jurisdicciones IIBB</legend>
              {jurisdictionCatalog.isLoading ? (
                <p>Cargando catálogo de jurisdicciones…</p>
              ) : jurisdictionCatalog.isError ? (
                <Notice tone="error">
                  No se pudo cargar el catálogo de jurisdicciones. Reintentá.
                </Notice>
              ) : (
                <div className="study-check-list">
                  {catalogData?.filter((entry) => entry.isActive).map((entry) => (
                    <label key={entry.code} className="study-check-option">
                      <input
                        type="checkbox"
                        checked={selectedJurisdictions.includes(entry.code)}
                        onChange={(event) => toggleJurisdiction(entry.code, event.target.checked)}
                      />
                      <span>
                        {entry.code} — {entry.name}
                      </span>
                    </label>
                  ))}
                  {catalogData?.filter((entry) => !entry.isActive && selectedJurisdictions.includes(entry.code)).map((entry) => (
                    <label key={entry.code} className="study-check-option">
                      <input type="checkbox" checked disabled />
                      <span>{entry.code} — {entry.name} (oculto)</span>
                    </label>
                  ))}
                </div>
              )}
              {outOfCatalogJurisdictions.length > 0 ? (
                <p className="study-legacy-note">
                  Estas jurisdicciones guardadas no están en el catálogo fiscal y se quitarán al
                  guardar: <strong>{outOfCatalogJurisdictions.join(", ")}</strong>
                </p>
              ) : null}
            </fieldset>
            <label className="ds-field">
              <span className="ds-field__label">Norma contable</span>
              <select
                id="client-profile-standard"
                className="ctxbar__input"
                value={standardValue}
                onChange={(event) =>
                  setProfileForm({ ...profileForm, accountingStandard: event.target.value })
                }
              >
                <option value="">Sin definir</option>
                {standardCatalogUnavailable ? (
                  <option value="" disabled>
                    No se pudo cargar el catálogo de normas
                  </option>
                ) : null}
                {standardCatalog
                  .filter((entry) => entry.isActive)
                  .map((entry) => (
                    <option key={entry.id} value={entry.name}>
                      {entry.name}
                    </option>
                  ))}
                {standardCatalog
                  .filter((entry) => !entry.isActive && entry.name === standardValue)
                  .map((entry) => (
                    <option key={entry.id} value={entry.name}>
                      {entry.name} — desactivada en el catálogo
                    </option>
                  ))}
                {standardUnknown ? (
                  <option value={standardValue}>{standardValue} — fuera de catálogo</option>
                ) : null}
              </select>
            </label>
            {standardUnknown ? (
              <Notice tone="warning">
                La norma contable guardada no está en el catálogo del estudio. Definila en Administración o elegí una del catálogo para guardar la ficha.
              </Notice>
            ) : null}
            <Field
              id="client-profile-service-start"
              label="Inicio del servicio"
              type="date"
              value={profileForm.serviceStartDate}
              onChange={(event) =>
                setProfileForm({ ...profileForm, serviceStartDate: event.target.value })
              }
            />
            {updateProfile.isError &&
            !(updateIdentity.isError && updateProfile.error.message === updateIdentity.error.message) ? (
              <Notice tone="error" className="study-inline-form__feedback">
                {updateProfile.error instanceof ApiError
                  ? updateProfile.error.message
                  : "No se pudo guardar la ficha. Revisá los datos e intentá nuevamente."}
              </Notice>
            ) : null}
            </section>
          </form>
        ) : null}
      </ActionDrawer>

      <ActionDrawer
        isOpen={Boolean(statusClient)}
        onClose={() => {
          setStatusClient(null);
          updateStatus.reset();
        }}
        title="Cambiar estado"
        description="Elegí el estado del cliente."
        footer={
          <Button
            type="submit"
            form="client-status-form"
            loading={updateStatus.isPending}
            loadingLabel="Guardando estado"
          >
            Guardar estado
          </Button>
        }
      >
        {statusClient ? (
          <form
            id="client-status-form"
            className="study-inline-form study-inline-form--client"
            onSubmit={(event) => {
              event.preventDefault();
              updateStatus.mutate();
            }}
          >
            <label className="ds-field">
              <span className="ds-field__label">Estado</span>
              <select
                id="client-status"
                className="ctxbar__input"
                value={statusForm}
                onChange={(event) => setStatusForm(event.target.value)}
              >
                <option value="ONBOARDING">En configuración</option>
                <option value="ACTIVE">Activo</option>
                <option value="INACTIVE">Inactivo</option>
                <option value="ARCHIVED">Archivado</option>
              </select>
            </label>
            {updateStatus.isError ? (
              <Notice tone="error" className="study-inline-form__feedback">
                {updateStatus.error instanceof ApiError
                  ? updateStatus.error.message
                  : "No se pudo actualizar el estado. Revisá los datos y los permisos."}
              </Notice>
            ) : null}
          </form>
        ) : null}
      </ActionDrawer>

      <ActionDrawer
        isOpen={contactEditorOpen}
        onClose={closeContactEditor}
        title={editingContact ? "Editar contacto" : "Nuevo contacto"}
        description="Completá los datos de contacto y, si corresponde, marcá el principal."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={closeContactEditor}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="client-contact-form"
              loading={saveContact.isPending}
              loadingLabel="Guardando contacto"
              disabled={contactForm.name.trim().length === 0}
            >
              Guardar contacto
            </Button>
          </>
        }
      >
        <form
          id="client-contact-form"
          className="study-inline-form study-inline-form--client"
          onSubmit={(event) => {
            event.preventDefault();
            saveContact.mutate();
          }}
        >
          <Field
            id="client-contact-name"
            label="Nombre"
            value={contactForm.name}
            onChange={(event) => setContactForm({ ...contactForm, name: event.target.value })}
            maxLength={200}
            required
          />
          <Field
            id="client-contact-function"
            label="Función"
            value={contactForm.function}
            onChange={(event) => setContactForm({ ...contactForm, function: event.target.value })}
            maxLength={100}
          />
          <Field
            id="client-contact-email"
            label="Email"
            type="email"
            value={contactForm.email}
            onChange={(event) => setContactForm({ ...contactForm, email: event.target.value })}
            maxLength={254}
          />
          <Field
            id="client-contact-phone"
            label="Teléfono"
            type="tel"
            value={contactForm.phone}
            onChange={(event) => setContactForm({ ...contactForm, phone: event.target.value })}
            maxLength={50}
          />
          <label className="client-contact-primary">
            <input
              type="checkbox"
              checked={contactForm.isPrimary}
              onChange={(event) => setContactForm({ ...contactForm, isPrimary: event.target.checked })}
            />
            <span>Contacto principal</span>
          </label>
          {saveContact.isError ? (
            <Notice tone="error" className="study-inline-form__feedback">
              {saveContact.error instanceof ApiError
                ? saveContact.error.message
                : "No se pudo guardar el contacto. Revisá los datos e intentá nuevamente."}
            </Notice>
          ) : null}
        </form>
      </ActionDrawer>

      {deletingClient && firmId ? (
        <DeletionDrawer
          isOpen
          path={`/firms/${firmId}/clients/${deletingClient.id}`}
          onClose={() => setDeletingClient(null)}
          onDeleted={async (result: DeletionResult) => {
            if (clientId === deletingClient.id) setClientId(null);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["clients", firmId] }),
              session.refresh(),
            ]);
            notify.success(
              result.storage?.failed
                ? `El cliente se eliminó; ${result.storage.failed} archivo(s) requieren limpieza posterior.`
                : "El cliente y sus registros dependientes se eliminaron.",
            );
          }}
        />
      ) : null}

    </DensePage>
  );
}
