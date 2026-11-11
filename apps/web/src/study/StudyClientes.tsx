import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field } from "@contable/design-system";
import { useNavigate } from "react-router-dom";
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
  DenseAlert,
  DenseFooter,
  DenseHeader,
  DenseLoading,
  DensePage,
  DenseSearch,
  DenseTable,
  DenseToolbar,
  DenseWorkspace,
  DensitySwitch,
  Inspector,
  InspectorFacts,
  InspectorSection,
  StatStrip,
  useDenseShortcuts,
  useDensity,
  type DenseColumn,
} from "../ui/Dense";
import { StatusBadge } from "../ui/StatusBadge";
import "./study.css";

function formatCuit(cuit: string) {
  return cuit.length === 11 ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}` : cuit;
}

const MONTH_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTH_LONG = [
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
];

function vatLabel(value: string | null | undefined): string {
  if (!value) return "";
  return (CLIENT_VAT_CONDITION_LABELS as Record<string, string>)[value] ?? value;
}

/** Datos de la ficha que todavía no se completaron (alimenta la métrica y el aviso). */
function profileGaps(client: { profile?: ClientProfile | null }): string[] {
  const profile = client.profile;
  const gaps: string[] = [];
  if (!profile?.vatCondition) gaps.push("condición IVA");
  if (!profile?.province) gaps.push("provincia");
  if (!profile?.activity) gaps.push("actividad");
  if (!profile?.accountingStandard) gaps.push("norma contable");
  return gaps;
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

/** Entrada del catálogo de normas contables definido por el estudio. */
interface AccountingStandardCatalogEntry {
  id: string;
  name: string;
  isActive: boolean;
}

interface ClientWithProfile extends Client {
  tradeName?: string | null;
  profile?: ClientProfile | null;
}

interface ClientContactForm {
  name: string;
  function: string;
  email: string;
  phone: string;
  isPrimary: boolean;
}

interface ClientProfileForm {
  functionalCurrency: string;
  accountingStandard: string;
  fiscalYearEndMonth: string;
  vatCondition: string;
  /** Códigos canónicos seleccionados del catálogo. null = derivar de lo guardado + catálogo. */
  iibbJurisdictions: string[] | null;
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
    iibbJurisdictions: null,
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
  const [statusFilter, setStatusFilter] = useState("");
  const [vatFilter, setVatFilter] = useState("");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [density, setDensity] = useDensity();
  const searchRef = useRef<HTMLInputElement>(null);
  const [identityClient, setIdentityClient] = useState<ClientWithProfile | null>(null);
  const [identityForm, setIdentityForm] = useState({
    legalName: "",
    tradeName: "",
    cuit: "",
    status: "ONBOARDING",
  });
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
  const [notice, setNotice] = useState<string | null>(null);
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
    mutationFn: () =>
      api.post<Client>(`/firms/${firmId}/clients`, {
        legalName: form.legalName.trim(),
        cuit: form.cuit,
        ...(form.tradeName.trim() ? { tradeName: form.tradeName.trim() } : {}),
        ...(form.vatCondition ? { vatCondition: form.vatCondition } : {}),
        ...(form.province ? { province: form.province } : {}),
        ...(form.activity ? { activity: form.activity } : {}),
        ...(form.legalForm ? { legalForm: form.legalForm } : {}),
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
        vatCondition: "",
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
    onSuccess: async () => {
      const clientName = editingClient?.legalName ?? "El cliente";
      await queryClient.invalidateQueries({ queryKey: ["clients", firmId] });
      setEditingClient(null);
      setNotice(`La ficha de ${clientName} quedó actualizada.`);
    },
  });
  const updateIdentity = useMutation({
    mutationFn: () => {
      if (!identityClient) throw new Error("Elegí un cliente para actualizar su identidad");
      return api.patch<Client>(`/firms/${firmId}/clients/${identityClient.id}`, {
        legalName: identityForm.legalName.trim(),
        tradeName: identityForm.tradeName.trim() || null,
        cuit: identityForm.cuit,
        status: identityForm.status,
      });
    },
    onSuccess: async (client) => {
      await queryClient.invalidateQueries({ queryKey: ["clients", firmId] });
      setIdentityClient(null);
      setNotice(`Los datos de ${client.legalName} se actualizaron.`);
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
  });
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es-AR");
    const digits = needle.replace(/\D/g, "");
    return (query.data ?? []).filter((client) => {
      if (statusFilter === "ACTIVE" && client.status !== "ACTIVE") return false;
      if (statusFilter === "INACTIVE" && client.status === "ACTIVE") return false;
      if (vatFilter && client.profile?.vatCondition !== vatFilter) return false;
      if (onlyIncomplete && profileGaps(client).length === 0) return false;
      if (!needle) return true;
      return (
        client.legalName.toLocaleLowerCase("es-AR").includes(needle) ||
        (client.tradeName ?? "").toLocaleLowerCase("es-AR").includes(needle) ||
        (digits !== "" && client.cuit.includes(digits))
      );
    });
  }, [query.data, search, statusFilter, vatFilter, onlyIncomplete]);

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
    setIdentityClient(null);
    setNotice(null);
    setEditingClient(client);
    setProfileForm(profileFormFrom(client));
  };

  const startIdentityEdit = (client: ClientWithProfile) => {
    setCreating(false);
    setEditingClient(null);
    setNotice(null);
    updateIdentity.reset();
    setIdentityClient(client);
    setIdentityForm({
      legalName: client.legalName,
      tradeName: client.tradeName ?? "",
      cuit: client.cuit,
      status: client.status,
    });
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
  const currentClient = clientId ? (clients.find((client) => client.id === clientId) ?? null) : null;
  const canManage = capabilities.has("client.manage");
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

  const columns: DenseColumn<ClientWithProfile>[] = [
    {
      key: "legalName",
      header: "Cliente",
      width: "20%",
      className: "client-list__client-column",
      sortValue: (row) => row.legalName.toLocaleLowerCase("es-AR"),
      render: (row) => (
        <button
          type="button"
          className="dense-name-button"
          aria-label={row.legalName}
          title={`${row.legalName}${row.tradeName ? ` — ${row.tradeName}` : ""}`}
          aria-current={clientId === row.id ? "true" : undefined}
          onClick={() => openClientWorkspace(row.id)}
        >
          <span className="dense-avatar" aria-hidden="true">
            {row.legalName.slice(0, 1).toLocaleUpperCase("es-AR")}
          </span>
          <span className="dense-name__text">
            <strong>{row.legalName}</strong>
            {row.tradeName ? <small>{row.tradeName}</small> : null}
          </span>
          {clientId === row.id ? <span className="dense-tag">En contexto</span> : null}
        </button>
      ),
    },
    {
      key: "cuit",
      header: "CUIT",
      width: "13%",
      className: "client-list__cuit-column",
      sortValue: (row) => row.cuit,
      render: (row) => <span className="tabular-copy">{formatCuit(row.cuit)}</span>,
    },
    {
      key: "vat",
      header: "Condición IVA",
      width: "11%",
      className: "client-list__vat-column",
      sortValue: (row) => vatLabel(row.profile?.vatCondition),
      render: (row) => vatLabel(row.profile?.vatCondition) || <span className="dense-dim">—</span>,
    },
    {
      key: "province",
      header: "Provincia",
      width: "8%",
      className: "client-list__secondary-column",
      secondary: true,
      sortValue: (row) => row.profile?.province ?? "",
      render: (row) => row.profile?.province || <span className="dense-dim">—</span>,
    },
    {
      key: "activity",
      header: "Actividad",
      width: "8%",
      className: "client-list__secondary-column",
      secondary: true,
      sortValue: (row) => row.profile?.activity ?? "",
      render: (row) => row.profile?.activity || <span className="dense-dim">—</span>,
    },
    {
      key: "standard",
      header: "Norma",
      width: "7%",
      className: "client-list__secondary-column",
      secondary: true,
      sortValue: (row) => row.profile?.accountingStandard ?? "",
      render: (row) => row.profile?.accountingStandard || <span className="dense-dim">—</span>,
    },
    {
      key: "closing",
      header: "Cierre",
      width: "6%",
      className: "client-list__secondary-column",
      secondary: true,
      sortValue: (row) => row.profile?.fiscalYearEndMonth ?? 0,
      render: (row) =>
        row.profile?.fiscalYearEndMonth ? (
          MONTH_SHORT[row.profile.fiscalYearEndMonth - 1]
        ) : (
          <span className="dense-dim">—</span>
        ),
    },
    {
      key: "gaps",
      header: "Ficha",
      width: "8%",
      className: "client-list__profile-column",
      sortValue: (row) => missingProfileFields(row).length,
      render: (row) => {
        const gaps = missingProfileFields(row);
        return gaps.length === 0 ? (
          <span className="dense-dim">Completa</span>
        ) : (
          <span className="dense-tag dense-tag--warn" title={`Falta: ${gaps.join(", ")}`}>
            Faltan {gaps.length}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Estado",
      width: "10%",
      className: "client-list__status-column",
      sortValue: (row) => row.status,
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "open",
      header: "",
      width: "9%",
      className: "client-list__action-column",
      sticky: "right",
      align: "right",
      render: (row) => (
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Abrir trabajo de ${row.legalName}`}
          onClick={(event) => {
            event.stopPropagation();
            openClientWorkspace(row.id);
          }}
        >
          Abrir
        </Button>
      ),
    },
  ];

  const inspector = selectedClient ? (
    <Inspector
      label={`Detalle de ${selectedClient.legalName}`}
      eyebrow="Cliente"
      title={selectedClient.legalName}
      subtitle={`CUIT ${formatCuit(selectedClient.cuit)}`}
      leading={
        <span className="dense-avatar dense-avatar--lg" aria-hidden="true">
          {selectedClient.legalName.slice(0, 1).toLocaleUpperCase("es-AR")}
        </span>
      }
      banner={
        missingProfileFields(selectedClient).length > 0 ? (
          <DenseAlert
            action={
              canManage ? (
                <Button size="sm" variant="secondary" onClick={() => startProfileEdit(selectedClient)}>
                  Completar
                </Button>
              ) : undefined
            }
          >
            Ficha incompleta: falta {missingProfileFields(selectedClient).join(", ")}.
          </DenseAlert>
        ) : undefined
      }
      onClose={() => setSelectedId(null)}
      footer={
        <>
          <Button size="sm" onClick={() => openClientWorkspace(selectedClient.id)}>
            Abrir trabajo
          </Button>
          <Button size="sm" variant="secondary" onClick={() => openClientSummary(selectedClient.id)}>
            Resumen
          </Button>
          {canManage ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => startIdentityEdit(selectedClient)}>
                Editar
              </Button>
              <Button size="sm" variant="secondary" onClick={() => startProfileEdit(selectedClient)}>
                Editar ficha
              </Button>
            </>
          ) : null}
          {capabilities.has("data.delete") ? (
            <Button size="sm" variant="danger" onClick={() => setDeletingClient(selectedClient)}>
              Eliminar
            </Button>
          ) : null}
        </>
      }
    >
      <InspectorSection title="Identificación">
        <InspectorFacts
          items={[
            ["Estado", <StatusBadge key="s" status={selectedClient.status} />],
            ["Nombre de fantasía", selectedClient.tradeName || "—"],
            ["Forma jurídica", selectedClient.profile?.legalForm || "—"],
            ["Provincia", selectedClient.profile?.province || "—"],
            ["Actividad", selectedClient.profile?.activity || "—"],
          ]}
        />
      </InspectorSection>
      <InspectorSection title="Perfil fiscal y contable">
        <InspectorFacts
          items={[
            ["Condición IVA", vatLabel(selectedClient.profile?.vatCondition) || "—"],
            ["Norma contable", selectedClient.profile?.accountingStandard || "—"],
            [
              "Cierre del ejercicio",
              selectedClient.profile?.fiscalYearEndMonth
                ? MONTH_LONG[selectedClient.profile.fiscalYearEndMonth - 1]
                : "—",
            ],
            ["Moneda funcional", selectedClient.profile?.functionalCurrency || "—"],
            [
              "Jurisdicciones IIBB",
              selectedClient.profile?.iibbJurisdictions?.length
                ? selectedClient.profile.iibbJurisdictions.join(", ")
                : "—",
            ],
            ["Inicio del servicio", selectedClient.profile?.serviceStartDate?.slice(0, 10) || "—"],
          ]}
        />
      </InspectorSection>
      {canManage ? (
        <InspectorSection title="Contactos">
          <div className="client-contacts__toolbar">
            <span className="dense-dim">
              {contactsQuery.data?.length ?? 0} {(contactsQuery.data?.length ?? 0) === 1 ? "contacto" : "contactos"}
            </span>
            <Button size="sm" onClick={() => openContactEditor()}>
              Nuevo contacto
            </Button>
          </div>
          {contactsQuery.isLoading ? (
            <p role="status">Cargando contactos…</p>
          ) : contactsQuery.isError ? (
            <p className="form-error" role="alert">
              No se pudieron cargar los contactos. Reintentá.
            </p>
          ) : contactsQuery.data?.length ? (
            <div className="client-contact-list">
              {contactsQuery.data.map((contact) => (
                <article
                  key={contact.id}
                  className={`client-contact${contact.isActive ? "" : " client-contact--inactive"}`}
                >
                  <div className="client-contact__main">
                    <div className="client-contact__heading">
                      <strong>{contact.name}</strong>
                      {contact.isPrimary ? <span className="dense-tag">Principal</span> : null}
                      {!contact.isActive ? <span className="dense-tag">Oculto</span> : null}
                    </div>
                    <div className="client-contact__details">
                      {contact.function ? <span>{contact.function}</span> : null}
                      {contact.email ? <span>{contact.email}</span> : null}
                      {contact.phone ? <span>{contact.phone}</span> : null}
                    </div>
                  </div>
                  <div className="client-contact__actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Editar contacto de ${contact.name}`}
                      onClick={() => openContactEditor(contact)}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`${contact.isActive ? "Ocultar" : "Mostrar"} contacto de ${contact.name}`}
                      loading={toggleContactState.isPending}
                      onClick={() => toggleContactState.mutate(contact)}
                    >
                      {contact.isActive ? "Ocultar" : "Mostrar"}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              size="compact"
              title="Todavía no hay contactos"
              description="Agregá personas de referencia para este cliente."
            />
          )}
          {toggleContactState.isError ? (
            <p className="form-error" role="alert">
              {toggleContactState.error instanceof ApiError
                ? toggleContactState.error.message
                : "No se pudo actualizar el contacto. Revisá los datos e intentá nuevamente."}
            </p>
          ) : null}
        </InspectorSection>
      ) : null}
    </Inspector>
  ) : null;

  const tableBody = query.isLoading ? (
    <DenseLoading label="Cargando la cartera…" />
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
  ) : (
    <DenseTable<ClientWithProfile>
      label="Cartera de clientes"
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
            ) : undefined
          }
        />
      }
    />
  );

  return (
    <DensePage density={density}>
      <DenseHeader
        eyebrow="Cartera del estudio"
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
          {
            key: "context",
            label: "Contexto actual",
            value: currentClient ? currentClient.legalName : "Sin seleccionar",
            detail: currentClient ? formatCuit(currentClient.cuit) : "Abrí un cliente para trabajar",
          },
        ]}
      />

      {notice ? (
        <div className="action-receipt action-receipt--page" role="status">
          <span>
            <strong>Actualización guardada</strong>
            <small>{notice}</small>
          </span>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}>
            Cerrar
          </button>
        </div>
      ) : null}

      <DenseToolbar>
        <DenseSearch
          inputRef={searchRef}
          value={search}
          onChange={setSearch}
          placeholder="Buscar por nombre o CUIT…"
          label="Buscar clientes"
        />
        <select
          className="dense-select"
          aria-label="Filtrar por estado"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="">Estado: todos</option>
          <option value="ACTIVE">Activos</option>
          <option value="INACTIVE">Inactivos</option>
        </select>
        <select
          className="dense-select"
          aria-label="Filtrar por condición IVA"
          value={vatFilter}
          onChange={(event) => setVatFilter(event.target.value)}
        >
          <option value="">IVA: todas</option>
          {CLIENT_VAT_CONDITIONS.map((value) => (
            <option key={value} value={value}>
              {CLIENT_VAT_CONDITION_LABELS[value]}
            </option>
          ))}
        </select>
        <span className="dense-toolbar__spacer" />
        <DensitySwitch value={density} onChange={setDensity} />
      </DenseToolbar>

      <DenseWorkspace panelId="clients-panel" inspector={inspector}>
        {tableBody}
      </DenseWorkspace>

      <ActionDrawer
        isOpen={creating}
        onClose={() => setCreating(false)}
        eyebrow="Cartera"
        title="Alta de cliente"
        description="Completá los datos fiscales básicos. La configuración fiscal completa queda como paso siguiente."
        footer={
          <>
            <span id="client-create-hint" className="client-create__hint" aria-live="polite">
              {createFieldsHint}
            </span>
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
            {clientActivityCatalog.isError ? (
              <small className="form-error">No se pudo cargar el catálogo de actividades. Reintentá.</small>
            ) : null}
          </label>
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
            <p className="form-error study-inline-form__feedback" role="alert">
              {create.error instanceof ApiError
                ? create.error.message
                : "No se pudo crear el cliente. Revisá los datos y los permisos."}
            </p>
          ) : null}
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={Boolean(identityClient)}
        onClose={() => {
          setIdentityClient(null);
          updateIdentity.reset();
        }}
        eyebrow="Cartera"
        title="Editar cliente"
        description="Actualizá la identidad y el estado del cliente."
        footer={
          <Button
            type="submit"
            form="client-identity-form"
            loading={updateIdentity.isPending}
            loadingLabel="Guardando cliente"
            disabled={identityForm.legalName.trim().length === 0 || identityForm.cuit.length !== 11}
          >
            Guardar cambios
          </Button>
        }
      >
        {identityClient ? (
          <form
            id="client-identity-form"
            className="study-inline-form study-inline-form--client"
            onSubmit={(event) => {
              event.preventDefault();
              updateIdentity.mutate();
            }}
          >
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
            <label className="ds-field">
              <span className="ds-field__label">Estado</span>
              <select
                id="client-identity-status"
                className="ctxbar__input"
                value={identityForm.status}
                onChange={(event) => setIdentityForm({ ...identityForm, status: event.target.value })}
              >
                <option value="ONBOARDING">En configuración</option>
                <option value="ACTIVE">Activo</option>
                <option value="INACTIVE">Inactivo</option>
                <option value="ARCHIVED">Archivado</option>
              </select>
            </label>
            {updateIdentity.isError &&
            !(updateIdentity.error instanceof ApiError &&
              updateIdentity.error.code === "CLIENT_CUIT_CONFLICT") ? (
              <p className="form-error study-inline-form__feedback" role="alert">
                {updateIdentity.error instanceof ApiError
                  ? updateIdentity.error.message
                  : "No se pudo guardar el cliente. Revisá los datos y los permisos."}
              </p>
            ) : null}
          </form>
        ) : null}
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
              disabled={currencyNotBacked || standardUnknown}
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
              {currencyNotBacked ? (
                <small className="form-error">
                  La moneda guardada no está respaldada por el sistema. Elegí{" "}
                  {BACKED_CURRENCIES.join(" o ")} para guardar la ficha.
                </small>
              ) : null}
            </label>
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
              {clientActivityCatalog.isError ? (
                <small className="form-error">No se pudo cargar el catálogo de actividades. Reintentá.</small>
              ) : null}
              {activityIsLegacy || activityIsInactive ? (
                <small className="study-legacy-note">
                  El valor guardado sigue visible y se conserva si no lo reemplazás.
                </small>
              ) : null}
            </label>
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
                <p className="form-error">
                  No se pudo cargar el catálogo de jurisdicciones. Reintentá.
                </p>
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
              {standardUnknown ? (
                <small className="form-error">
                  La norma contable guardada no está en el catálogo del estudio. Definila en
                  Administración o elegí una del catálogo para guardar la ficha.
                </small>
              ) : null}
            </label>
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
                {updateProfile.error instanceof ApiError
                  ? updateProfile.error.message
                  : "No se pudo guardar la ficha. Revisá los datos e intentá nuevamente."}
              </p>
            ) : null}
          </form>
        ) : null}
      </ActionDrawer>

      <ActionDrawer
        isOpen={contactEditorOpen}
        onClose={closeContactEditor}
        eyebrow="Cliente"
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
            <p className="form-error study-inline-form__feedback" role="alert">
              {saveContact.error instanceof ApiError
                ? saveContact.error.message
                : "No se pudo guardar el contacto. Revisá los datos e intentá nuevamente."}
            </p>
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
            setNotice(
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
