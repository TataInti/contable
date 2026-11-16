import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Notice, useNotify } from "@contable/design-system";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { type CatalogJurisdiction, type ClientEconomicActivityOption } from "@contable/contracts";
import { ApiError, api, type Client, type ClientContact } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
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
import { PanelAlta, type FormularioAlta } from "./clientes/paneles/PanelAlta";
import { PanelContacto } from "./clientes/paneles/PanelContacto";
import { PanelEdicion, type FormularioIdentidad } from "./clientes/paneles/PanelEdicion";
import { PanelEstado } from "./clientes/paneles/PanelEstado";
import { sinRespuesta } from "./clientes/consultas";
import { useCatalogosFicha } from "./clientes/useCatalogosFicha";
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
  const [identityForm, setIdentityForm] = useState<FormularioIdentidad>({
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
  const [form, setForm] = useState<FormularioAlta>({
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
  // D5-8: guardado parcial de la ficha. Indica qué quedó guardado («identidad» o «ficha»).
  const [guardadoParcial, setGuardadoParcial] = useState<"identidad" | "ficha" | null>(null);
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
  const catalogos = useCatalogosFicha({
    jurisdictionCatalog,
    clientActivityCatalog,
    accountingStandardsCatalog,
    editingClient,
    profileForm,
    setProfileForm,
  });
  const { selectedJurisdictions, standardValue } = catalogos;
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
    setGuardadoParcial(null);
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
    setGuardadoParcial(null);
    const [identidad, ficha] = await Promise.allSettled([
      updateIdentity.mutateAsync(),
      updateProfile.mutateAsync(),
    ]);
    await queryClient.invalidateQueries({ queryKey: ["clients", firmId] });
    if (identidad.status === "fulfilled" && ficha.status === "fulfilled") {
      setEditingClient(null);
      notify.success(`La ficha de ${clientName} quedó actualizada.`);
    } else if (identidad.status === "fulfilled" || ficha.status === "fulfilled") {
      // Guardado parcial: el cajón sigue abierto con sus datos y un solo mensaje dice qué quedó guardado.
      setGuardadoParcial(identidad.status === "fulfilled" ? "identidad" : "ficha");
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

  const tableBody = sinRespuesta(query) ? (
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
              ? canManage
                ? "Creá el primer cliente para comenzar a organizar la operación."
                : "Para cargar el primero hace falta el permiso de crear clientes. Pedíselo a quien administra el estudio."
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
          },
          {
            key: "incomplete",
            label: "Ficha incompleta",
            value: query.data ? incompleteCount : "—",
            detail: "Faltan datos fiscales",
            tone: incompleteCount > 0 ? "warn" : undefined,
            active: onlyIncomplete,
            pressed: onlyIncomplete,
            onSelect: () => setOnlyIncomplete((current) => !current),
          },
        ]}
      />

      {contactRetry ? (
        <Notice
          tone="error"
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
          {retryContact.isError ? (
            <p>No se pudo registrar el correo. Reintentá o agregalo desde Contactos.</p>
          ) : null}
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

      <DenseWorkspace
        panelId="clients-panel"
        role="region"
        aria-label="Cartera de clientes y detalle"
        inspector={inspector}
      >
        {tableBody}
      </DenseWorkspace>

      <PanelAlta
        creating={creating}
        setCreating={setCreating}
        form={form}
        setForm={setForm}
        create={create}
        createFieldsHint={createFieldsHint}
        missingCreateFields={missingCreateFields}
        clientActivityCatalog={clientActivityCatalog}
        activeActivityEntries={catalogos.activeActivityEntries}
      />

      <PanelEdicion
        editingClient={editingClient}
        guardadoParcial={guardadoParcial}
        setEditingClient={setEditingClient}
        identityForm={identityForm}
        setIdentityForm={setIdentityForm}
        profileForm={profileForm}
        setProfileForm={setProfileForm}
        updateIdentity={updateIdentity}
        updateProfile={updateProfile}
        submitClientEdit={submitClientEdit}
        jurisdictionCatalog={jurisdictionCatalog}
        clientActivityCatalog={clientActivityCatalog}
        catalogos={catalogos}
      />

      <PanelEstado
        statusClient={statusClient}
        setStatusClient={setStatusClient}
        updateStatus={updateStatus}
        statusForm={statusForm}
        setStatusForm={setStatusForm}
      />

      <PanelContacto
        contactEditorOpen={contactEditorOpen}
        closeContactEditor={closeContactEditor}
        editingContact={editingContact}
        contactForm={contactForm}
        setContactForm={setContactForm}
        saveContact={saveContact}
      />

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
