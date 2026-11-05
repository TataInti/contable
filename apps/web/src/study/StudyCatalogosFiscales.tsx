import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field } from "@contable/design-system";
import { ACTIVITY_CODE_PATTERN, normalizeActivityCode } from "@contable/contracts";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { ActionDrawer } from "../ui/ActionDrawer";
import { DeletionDrawer } from "../ui/DeletionDrawer";
import {
  DenseAlert,
  DenseHeader,
  DensePage,
  DenseSearch,
  DensitySwitch,
  DenseTable,
  DenseTabs,
  DenseToolbar,
  DenseWorkspace,
  Inspector,
  InspectorFacts,
  InspectorSection,
  ShortcutHint,
  StatStrip,
  normalizeSearch,
  useDenseShortcuts,
  useDensity,
  type DenseColumn,
} from "../ui/Dense";
import { Icon } from "../ui/Icon";
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
  origin?: "REFERENCE" | "UI";
  createdByFirmId?: string | null;
  jurisdiction: JurisdictionOption;
}

interface TaxRegimeRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  origin?: "REFERENCE" | "UI";
  createdByFirmId?: string | null;
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
  origin?: "REFERENCE" | "UI";
  createdByFirmId?: string | null;
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

type CatalogTab = "authorities" | "regimes" | "activities";

function ActivityStateBadge({ isActive }: { isActive: boolean }) {
  return (
    <span className={`study-badge ${isActive ? "study-badge--ok" : "study-badge--muted"}`}>
      {isActive ? "Activa" : "Desactivada"}
    </span>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className={`status-badge status-badge--${active ? "ok" : "muted"}`}>
      {active ? "Activo" : "Inactivo"}
    </span>
  );
}

function OriginBadge({ origin }: { origin?: "REFERENCE" | "UI" }) {
  if (!origin) return <span className="muted-copy">—</span>;
  return (
    <span className={`status-badge status-badge--${origin === "UI" ? "info" : "muted"}`}>
      {origin === "UI" ? "Del estudio" : "Referencia"}
    </span>
  );
}

function isOwnedUiRecord(
  row: { origin?: string; createdByFirmId?: string | null },
  firmId: string,
): boolean {
  return row.origin === "UI" && row.createdByFirmId === firmId;
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
  const canDelete = capabilities.has("data.delete");
  const [drawer, setDrawer] = useState<"authority" | "regime" | null>(null);
  const [activityDrawer, setActivityDrawer] = useState<"create" | "edit" | "deactivate" | null>(null);
  const [editingActivity, setEditingActivity] = useState<CatalogActivityRow | null>(null);
  const [activityForm, setActivityForm] = useState<ActivityForm>(emptyActivityForm);
  const [tab, setTab] = useState<CatalogTab>("authorities");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [jurisdictionFilter, setJurisdictionFilter] = useState("");
  const [originFilter, setOriginFilter] = useState<"" | "REFERENCE" | "UI">("");
  const [stateFilter, setStateFilter] = useState<"" | "active" | "inactive">("");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [density, setDensity] = useDensity();
  const searchRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<() => void>(() => undefined);
  useDenseShortcuts({
    searchRef,
    onNew: () => createRef.current(),
    onEscape: () => setSelectedId(null),
  });
  const [receipt, setReceipt] = useState<string | null>(null);
  const [deletingTarget, setDeletingTarget] = useState<{ path: string } | null>(null);
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
  // Desactivar conserva el historial. El Titular también puede eliminar una
  // actividad UI sin dependencias desde su preview de impacto.
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
  const activityCodeValid = ACTIVITY_CODE_PATTERN.test(normalizeActivityCode(activityForm.code));
  const activityValidityValid =
    !activityForm.validTo || activityForm.validFrom <= activityForm.validTo;

  const authorities = authoritiesQuery.data ?? [];
  const regimes = regimesQuery.data ?? [];
  const activities = activitiesQuery.data ?? [];
  // El régimen puede venir con el organismo "plano": se completa con la lista de organismos.
  const authorityOf = (row: TaxRegimeRow) =>
    authorities.find((item) => item.id === row.authority.id) ?? row.authority;
  const authorityJurisdictionName = (row: TaxRegimeRow) =>
    authorityOf(row).jurisdiction?.name ??
    jurisdictionsQuery.data?.find((item) => item.id === authorityOf(row).jurisdictionId)?.name ??
    "otra jurisdicción";
  const regimeMismatch = (row: TaxRegimeRow) => {
    const authorityJurisdictionId = authorityOf(row).jurisdictionId;
    return Boolean(authorityJurisdictionId) && authorityJurisdictionId !== row.jurisdiction.id;
  };
  const mismatchedRegimes = regimes.filter(regimeMismatch);
  const regimesByAuthority = (authorityId: string) =>
    regimes.filter((row) => row.authority.id === authorityId);
  const originKnown = [...authorities, ...regimes, ...activities].some((row) => row.origin);
  const studioRecords = [...authorities, ...regimes, ...activities].filter(
    (row) => row.origin === "UI",
  ).length;
  const totalRecords = authorities.length + regimes.length + activities.length;

  const searchQuery = normalizeSearch(search);
  const textMatch = (...parts: Array<string | null | undefined>) =>
    !searchQuery || normalizeSearch(parts.filter(Boolean).join(" ")).includes(searchQuery);
  const commonMatch = (
    row: { isActive: boolean; origin?: "REFERENCE" | "UI" },
    jurisdictionId: string,
  ) =>
    (!jurisdictionFilter || jurisdictionId === jurisdictionFilter) &&
    (!originFilter || row.origin === originFilter) &&
    (!stateFilter || (stateFilter === "active") === row.isActive);

  const visibleAuthorities = authorities.filter(
    (row) =>
      commonMatch(row, row.jurisdictionId) &&
      textMatch(row.code, row.name, row.jurisdiction.name, row.jurisdiction.code),
  );
  const visibleRegimes = regimes.filter(
    (row) =>
      commonMatch(row, row.jurisdiction.id) &&
      (!alertsOnly || regimeMismatch(row)) &&
      textMatch(
        row.code,
        row.name,
        row.taxType.name,
        row.taxType.code,
        row.jurisdiction.name,
        row.authority.code,
        row.authority.name,
      ),
  );
  const visibleActivities = activities.filter(
    (row) =>
      commonMatch(row, row.jurisdictionId) &&
      textMatch(row.code, row.name, row.source, jurisdictionName(row.jurisdictionId)),
  );

  const selectedAuthority = authorities.find((row) => row.id === selectedId) ?? null;
  const selectedRegime = regimes.find((row) => row.id === selectedId) ?? null;
  const selectedActivity = activities.find((row) => row.id === selectedId) ?? null;
  const inspectorOpen =
    (tab === "authorities" && Boolean(selectedAuthority)) ||
    (tab === "regimes" && Boolean(selectedRegime)) ||
    (tab === "activities" && Boolean(selectedActivity));

  const switchTab = (next: CatalogTab) => {
    setTab(next);
    setSelectedId(null);
    setAlertsOnly(false);
  };
  const showMismatches = () => {
    setTab("regimes");
    setSelectedId(null);
    setAlertsOnly((current) => !current);
  };

  const openActivityEdit = (row: CatalogActivityRow) => {
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
  };

  const jurisdictionsReady = (jurisdictionsQuery.data?.length ?? 0) > 0;
  const canCreateRegime =
    jurisdictionsReady &&
    (taxTypesQuery.data?.length ?? 0) > 0 &&
    (authoritiesQuery.data?.length ?? 0) > 0;
  const createLabel = {
    authorities: "Nuevo organismo",
    regimes: "Nuevo régimen",
    activities: "Nueva actividad",
  }[tab];
  const createDisabled =
    tab === "regimes" ? !canCreateRegime : tab === "activities" ? !jurisdictionsReady : false;
  const openCreate = () => {
    if (!canPropose || createDisabled) return;
    if (tab === "authorities") setDrawer("authority");
    else if (tab === "regimes") setDrawer("regime");
    else {
      setEditingActivity(null);
      setActivityForm(emptyActivityForm);
      setActivityDrawer("create");
    }
  };
  createRef.current = openCreate;

  const count = (value: number, loading: boolean) => (loading ? "—" : value);
  const tabHints: Record<CatalogTab, string> = {
    authorities:
      "Quién recauda cada impuesto según la jurisdicción: ARCA en Nación, la DGR provincial o la dirección municipal de rentas.",
    regimes: "Cada régimen requiere impuesto, jurisdicción y organismo recaudador compatibles.",
    activities:
      "El código es clave histórica: las actividades con dependencias se desactivan en lugar de eliminarse.",
  };
  const visibleCount =
    tab === "authorities"
      ? visibleAuthorities.length
      : tab === "regimes"
        ? visibleRegimes.length
        : visibleActivities.length;
  const totalCount =
    tab === "authorities" ? authorities.length : tab === "regimes" ? regimes.length : activities.length;

  const tableFooter = (
    <>
      <span>
        {visibleCount} de {totalCount}
      </span>
      <span className="dense-table-foot__hint">{tabHints[tab]}</span>
      <span className="dense-table-foot__spacer" />
      <ShortcutHint
        items={[
          ["↑↓", "navegar"],
          ["/", "buscar"],
          ...(canPropose ? ([["N", "nuevo"]] as Array<[string, string]>) : []),
          ["Esc", "cerrar"],
        ]}
      />
    </>
  );

  const loadingFor = (loading: boolean, label: string) =>
    loading ? (
      <div className="dense-table-card">
        <p className="muted-copy dense-empty">{label}</p>
      </div>
    ) : null;

  const deleteButton = (path: string, push = false) => (
    <Button
      size="sm"
      variant="danger"
      className={push ? "dense-push" : undefined}
      onClick={() => setDeletingTarget({ path: `/firms/${firmId}${path}` })}
    >
      Eliminar
    </Button>
  );

  let inspector: ReactNode = null;
  if (tab === "authorities" && selectedAuthority) {
    const linked = regimesByAuthority(selectedAuthority.id);
    inspector = (
      <Inspector
        label="Detalle del organismo"
        eyebrow="Organismo"
        title={selectedAuthority.code}
        subtitle={selectedAuthority.name}
        onClose={() => setSelectedId(null)}
        footer={
          canDelete && isOwnedUiRecord(selectedAuthority, firmId)
            ? deleteButton(`/tax/authorities/${selectedAuthority.id}`)
            : undefined
        }
      >
        <InspectorSection title="Ficha">
          <InspectorFacts
            items={[
              [
                "Jurisdicción",
                <>
                  {selectedAuthority.jurisdiction.name}{" "}
                  <span className="dense-chip">{selectedAuthority.jurisdiction.code}</span>
                </>,
              ],
              ["Origen", selectedAuthority.origin ? <OriginBadge key="origin" origin={selectedAuthority.origin} /> : null],
              ["Estado", <ActiveBadge key="state" active={selectedAuthority.isActive} />],
            ]}
          />
        </InspectorSection>
        <InspectorSection title={`Regímenes vinculados · ${linked.length}`}>
          {linked.length > 0 ? (
            <ul className="dense-linked">
              {linked.map((row) => (
                <li key={row.id}>
                  <strong>{row.code}</strong>
                  <span title={row.name}>{row.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>Ningún régimen usa este organismo.</p>
          )}
        </InspectorSection>
      </Inspector>
    );
  } else if (tab === "regimes" && selectedRegime) {
    const mismatch = regimeMismatch(selectedRegime);
    inspector = (
      <Inspector
        label="Detalle del régimen"
        eyebrow="Régimen"
        title={selectedRegime.code}
        subtitle={selectedRegime.name}
        onClose={() => setSelectedId(null)}
        footer={
          canDelete && isOwnedUiRecord(selectedRegime, firmId)
            ? deleteButton(`/tax/regimes/${selectedRegime.id}`)
            : undefined
        }
      >
        <InspectorSection title="Cadena de vinculación">
          <div className="dense-chain">
            <span>
              <small>Impuesto</small>
              {selectedRegime.taxType.name}
            </span>
            <span className="dense-chain__arrow" aria-hidden="true">
              →
            </span>
            <span>
              <small>Jurisdicción</small>
              {selectedRegime.jurisdiction.name}
            </span>
            <span className="dense-chain__arrow" aria-hidden="true">
              →
            </span>
            <span className={mismatch ? "dense-chain__bad" : undefined}>
              <small>Organismo</small>
              {selectedRegime.authority.code}
            </span>
          </div>
          <div className={`dense-note ${mismatch ? "dense-note--warn" : "dense-note--ok"}`}>
            <Icon name={mismatch ? "alert" : "check"} size={14} />
            <span>
              {mismatch
                ? `${selectedRegime.authority.code} recauda en ${authorityJurisdictionName(selectedRegime)}; el régimen es de ${selectedRegime.jurisdiction.name}. Revisá el organismo.`
                : "El organismo corresponde a la jurisdicción del régimen."}
            </span>
          </div>
        </InspectorSection>
        <InspectorSection title="Ficha">
          <InspectorFacts
            items={[
              [
                "Impuesto",
                <>
                  {selectedRegime.taxType.name}{" "}
                  <span className="dense-chip">{selectedRegime.taxType.code}</span>
                </>,
              ],
              ["Organismo", selectedRegime.authority.name],
              ["Origen", selectedRegime.origin ? <OriginBadge key="origin" origin={selectedRegime.origin} /> : null],
              ["Estado", <ActiveBadge key="state" active={selectedRegime.isActive} />],
            ]}
          />
        </InspectorSection>
      </Inspector>
    );
  } else if (tab === "activities" && selectedActivity) {
    const ownedUi = canDelete && isOwnedUiRecord(selectedActivity, firmId);
    inspector = (
      <Inspector
        label="Detalle de la actividad"
        eyebrow="Actividad económica"
        title={selectedActivity.code}
        subtitle={selectedActivity.name}
        onClose={() => setSelectedId(null)}
        footer={
          canPropose || ownedUi ? (
            <>
              {canPropose ? (
                <>
                  <Button size="sm" variant="secondary" onClick={() => openActivityEdit(selectedActivity)}>
                    Editar
                  </Button>
                  {selectedActivity.isActive ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        setEditingActivity(selectedActivity);
                        setActivityDrawer("deactivate");
                      }}
                    >
                      Desactivar
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => toggleActivity.mutate(selectedActivity)}
                      loading={
                        toggleActivity.isPending && toggleActivity.variables?.id === selectedActivity.id
                      }
                    >
                      Reactivar
                    </Button>
                  )}
                </>
              ) : null}
              {ownedUi ? deleteButton(`/tax/activities/${selectedActivity.id}`, true) : null}
            </>
          ) : undefined
        }
      >
        <InspectorSection title="Ficha">
          <InspectorFacts
            items={[
              ["Jurisdicción", jurisdictionName(selectedActivity.jurisdictionId)],
              ["Fuente", selectedActivity.source ?? "—"],
              [
                "Vigencia",
                `${shortDate(selectedActivity.validFrom)} → ${shortDate(selectedActivity.validTo)}`,
              ],
              ["Origen", selectedActivity.origin ? <OriginBadge key="origin" origin={selectedActivity.origin} /> : null],
              ["Estado", <ActivityStateBadge key="state" isActive={selectedActivity.isActive} />],
              ...(selectedActivity.activeClientLinks !== undefined
                ? ([["Clientes", `${selectedActivity.activeClientLinks} vínculo(s) vigente(s)`]] as Array<
                    [string, ReactNode]
                  >)
                : []),
            ]}
          />
        </InspectorSection>
        <InspectorSection title="Historial">
          <p>
            El código se conserva como clave histórica. Si tiene dependencias, la actividad se
            desactiva en lugar de eliminarse.
          </p>
        </InspectorSection>
      </Inspector>
    );
  }

  const authorityColumns: DenseColumn<TaxAuthorityRow>[] = [
    {
      key: "code",
      header: "Código",
      sortValue: (row) => row.code,
      render: (row) => <span className="dense-code">{row.code}</span>,
    },
    {
      key: "name",
      header: "Organismo",
      sortValue: (row) => row.name,
      render: (row) => <span title={row.name}>{row.name}</span>,
    },
    {
      key: "jurisdiction",
      header: "Jurisdicción",
      sortValue: (row) => row.jurisdiction.name,
      render: (row) => (
        <span className="dense-cell-inline">
          {row.jurisdiction.name}
          <span className="dense-chip dense-chip--hide-narrow">{row.jurisdiction.code}</span>
        </span>
      ),
    },
    {
      key: "regimes",
      header: "Regímenes",
      align: "right",
      sortValue: (row) => regimesByAuthority(row.id).length,
      render: (row) => regimesByAuthority(row.id).length || "—",
    },
    {
      key: "origin",
      header: "Origen",
      secondary: true,
      sortValue: (row) => row.origin ?? "",
      render: (row) => <OriginBadge origin={row.origin} />,
    },
    {
      key: "state",
      header: "Estado",
      secondary: true,
      sortValue: (row) => row.isActive,
      render: (row) => <ActiveBadge active={row.isActive} />,
    },
  ];

  const regimeColumns: DenseColumn<TaxRegimeRow>[] = [
    {
      key: "code",
      header: "Código",
      sortValue: (row) => row.code,
      render: (row) => <span className="dense-code">{row.code}</span>,
    },
    {
      key: "name",
      header: "Régimen",
      sortValue: (row) => row.name,
      render: (row) => <span title={row.name}>{row.name}</span>,
    },
    {
      key: "taxType",
      header: "Impuesto",
      secondary: true,
      sortValue: (row) => row.taxType.name,
      render: (row) => (
        <span className="dense-cell-inline" title={`${row.taxType.name} (${row.taxType.code})`}>
          {row.taxType.name}
          <span className="dense-chip">{row.taxType.code}</span>
        </span>
      ),
    },
    {
      key: "jurisdiction",
      header: "Jurisdicción",
      sortValue: (row) => row.jurisdiction.name,
      render: (row) => (
        <span className="dense-cell-inline">
          {row.jurisdiction.name}
          <span className="dense-chip dense-chip--hide-narrow">{row.jurisdiction.code}</span>
        </span>
      ),
    },
    {
      key: "authority",
      header: "Organismo",
      sortValue: (row) => row.authority.code,
      render: (row) => (
        <span className="dense-chip" title={row.authority.name}>
          {row.authority.code}
        </span>
      ),
    },
    {
      key: "coherence",
      header: "Coherencia",
      sortValue: (row) => (regimeMismatch(row) ? 0 : 1),
      render: (row) =>
        regimeMismatch(row) ? (
          <span
            className="dense-coherence dense-coherence--bad"
            title={`${row.authority.code} recauda en ${authorityJurisdictionName(row)}, no en ${row.jurisdiction.name}`}
          >
            <Icon name="alert" size={14} />
            Revisar
          </span>
        ) : (
          <span className="dense-coherence dense-coherence--ok">
            <Icon name="check" size={14} />
            OK
          </span>
        ),
    },
    {
      key: "origin",
      header: "Origen",
      secondary: true,
      sortValue: (row) => row.origin ?? "",
      render: (row) => <OriginBadge origin={row.origin} />,
    },
    {
      key: "state",
      header: "Estado",
      secondary: true,
      sortValue: (row) => row.isActive,
      render: (row) => <ActiveBadge active={row.isActive} />,
    },
  ];

  const activityColumns: DenseColumn<CatalogActivityRow>[] = [
    {
      key: "code",
      header: "Código",
      sortValue: (row) => row.code,
      render: (row) => (
        <span className="dense-code" title={row.code}>
          {row.code}
        </span>
      ),
    },
    {
      key: "name",
      header: "Actividad",
      sortValue: (row) => row.name,
      render: (row) => <span title={row.name}>{row.name}</span>,
    },
    {
      key: "jurisdiction",
      header: "Jurisdicción",
      sortValue: (row) => jurisdictionName(row.jurisdictionId),
      render: (row) => (
        <span title={jurisdictionName(row.jurisdictionId)}>{jurisdictionName(row.jurisdictionId)}</span>
      ),
    },
    {
      key: "source",
      header: "Fuente",
      sortValue: (row) => row.source ?? "",
      render: (row) => <span title={row.source ?? undefined}>{row.source ?? "—"}</span>,
    },
    {
      key: "validity",
      header: "Vigencia",
      sortValue: (row) => row.validFrom,
      render: (row) => `${shortDate(row.validFrom)} — ${shortDate(row.validTo)}`,
    },
    {
      key: "origin",
      header: "Origen",
      secondary: true,
      sortValue: (row) => row.origin ?? "",
      render: (row) => <OriginBadge origin={row.origin} />,
    },
    {
      key: "state",
      header: "Estado",
      secondary: true,
      sortValue: (row) => row.isActive,
      render: (row) => <ActivityStateBadge isActive={row.isActive} />,
    },
  ];

  const select = (key: string | null) => setSelectedId(key);

  let tableBody: ReactNode;
  if (tab === "authorities") {
    tableBody =
      loadingFor(authoritiesQuery.isLoading, "Cargando organismos recaudadores…") ??
      (authoritiesQuery.isError ? null : (
        <DenseTable<TaxAuthorityRow>
          label="Organismos recaudadores"
          columns={authorityColumns.filter((column) => originKnown || column.key !== "origin")}
          rows={visibleAuthorities}
          rowKey={(row) => row.id}
          selectedKey={selectedId}
          onSelect={select}
          inspectorOpen={inspectorOpen}
          rowClassName={(row) => (row.isActive ? undefined : "dense-row--muted")}
          footer={tableFooter}
          empty={
            <EmptyState
              size="compact"
              title={
                authorities.length === 0
                  ? "Todavía no hay organismos recaudadores"
                  : "Ningún organismo coincide con los filtros"
              }
              description={
                authorities.length === 0
                  ? "Creá un organismo asociado a una jurisdicción para poder registrar regímenes."
                  : "Probá con otro código o nombre, o quitá filtros."
              }
            />
          }
        />
      ));
  } else if (tab === "regimes") {
    tableBody =
      loadingFor(regimesQuery.isLoading, "Cargando regímenes…") ??
      (regimesQuery.isError ? null : (
        <DenseTable<TaxRegimeRow>
          label="Regímenes"
          columns={regimeColumns.filter((column) => originKnown || column.key !== "origin")}
          rows={visibleRegimes}
          rowKey={(row) => row.id}
          selectedKey={selectedId}
          onSelect={select}
          inspectorOpen={inspectorOpen}
          rowClassName={(row) => (row.isActive ? undefined : "dense-row--muted")}
          footer={tableFooter}
          empty={
            <EmptyState
              size="compact"
              title={
                regimes.length === 0
                  ? "Todavía no hay regímenes fiscales"
                  : "Ningún régimen coincide con los filtros"
              }
              description={
                regimes.length === 0
                  ? "Definí un régimen con un organismo recaudador y jurisdicción verificados."
                  : "Probá con otro código o nombre, o quitá filtros."
              }
            />
          }
        />
      ));
  } else {
    tableBody =
      loadingFor(activitiesQuery.isLoading, "Cargando actividades económicas…") ??
      (activitiesQuery.isError ? null : (
        <DenseTable<CatalogActivityRow>
          label="Actividades económicas"
          columns={activityColumns.filter((column) => originKnown || column.key !== "origin")}
          rows={visibleActivities}
          rowKey={(row) => row.id}
          selectedKey={selectedId}
          onSelect={select}
          inspectorOpen={inspectorOpen}
          rowClassName={(row) => (row.isActive ? undefined : "dense-row--muted")}
          footer={tableFooter}
          empty={
            <EmptyState
              size="compact"
              title={
                searchQuery
                  ? "Ninguna actividad coincide con la búsqueda"
                  : "Todavía no hay actividades económicas"
              }
              description={
                searchQuery
                  ? "Probá con otro código o nombre."
                  : "Creá una actividad para poder vincularla a clientes y reglas fiscales."
              }
            />
          }
        />
      ));
  }

  return (
    <DensePage density={density}>
      <DenseHeader
        eyebrow="Administración fiscal"
        title="Catálogos fiscales"
        description="Organismos recaudadores, regímenes y actividades que se vinculan a la configuración fiscal de cada cliente. Usá códigos verificados e identificá los datos de prueba como sintéticos."
        actions={
          canPropose ? (
            <Button size="sm" onClick={openCreate} disabled={createDisabled}>
              {createLabel}
            </Button>
          ) : null
        }
      />

      <StatStrip
        label="Resumen de catálogos"
        items={[
          {
            key: "authorities",
            label: "Organismos",
            value: count(authorities.length, authoritiesQuery.isLoading),
            active: tab === "authorities",
            onSelect: () => switchTab("authorities"),
          },
          {
            key: "regimes",
            label: "Regímenes",
            value: count(regimes.length, regimesQuery.isLoading),
            active: tab === "regimes",
            onSelect: () => switchTab("regimes"),
          },
          {
            key: "activities",
            label: "Actividades",
            value: count(activities.length, activitiesQuery.isLoading),
            active: tab === "activities",
            onSelect: () => switchTab("activities"),
          },
          ...(originKnown
            ? [
                {
                  key: "studio",
                  label: "Creados por el estudio",
                  value: studioRecords,
                  detail: `de ${totalRecords}`,
                },
              ]
            : []),
          {
            key: "mismatch",
            label: "Alertas de coherencia",
            value: mismatchedRegimes.length,
            detail: mismatchedRegimes.length > 0 ? "ver regímenes" : "sin alertas",
            tone: mismatchedRegimes.length > 0 ? "warn" : undefined,
            onSelect: mismatchedRegimes.length > 0 ? showMismatches : undefined,
          },
        ]}
      />

      <DenseTabs<CatalogTab>
        label="Catálogos fiscales"
        idPrefix="catalog-tab"
        active={tab}
        onChange={switchTab}
        tabs={[
          { id: "authorities", label: "Organismos recaudadores", count: authorities.length },
          {
            id: "regimes",
            label: "Regímenes",
            count: regimes.length,
            warnCount: mismatchedRegimes.length,
          },
          { id: "activities", label: "Actividades económicas", count: activities.length },
        ]}
      />

      {failedQueries.map(({ label, query }) => (
        <div className="form-error" role="alert" key={label}>
          <strong>No pudimos cargar {label}.</strong>{" "}
          <button type="button" className="fiscal-retry" onClick={() => void query.refetch()}>
            Reintentar
          </button>
        </div>
      ))}

      <DenseToolbar>
        <DenseSearch
          inputRef={searchRef}
          value={search}
          onChange={setSearch}
          placeholder="Buscar código o nombre…"
        />
        <select
          className="dense-select"
          aria-label="Filtrar por jurisdicción"
          value={jurisdictionFilter}
          onChange={(event) => setJurisdictionFilter(event.target.value)}
        >
          <option value="">Jurisdicción: todas</option>
          {jurisdictionsQuery.data?.map((jurisdiction) => (
            <option key={jurisdiction.id} value={jurisdiction.id}>
              {jurisdiction.name} ({jurisdiction.code})
            </option>
          ))}
        </select>
        {originKnown ? (
          <select
            className="dense-select"
            aria-label="Filtrar por origen"
            value={originFilter}
            onChange={(event) => setOriginFilter(event.target.value as "" | "REFERENCE" | "UI")}
          >
            <option value="">Origen: todos</option>
            <option value="REFERENCE">Referencia</option>
            <option value="UI">Del estudio</option>
          </select>
        ) : null}
        <select
          className="dense-select"
          aria-label="Filtrar por estado"
          value={stateFilter}
          onChange={(event) => setStateFilter(event.target.value as "" | "active" | "inactive")}
        >
          <option value="">Estado: todos</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
        {tab === "regimes" ? (
          <button
            type="button"
            className="dense-toggle"
            aria-pressed={alertsOnly}
            onClick={() => setAlertsOnly((current) => !current)}
          >
            <Icon name="alert" size={14} />
            Sólo con alertas
          </button>
        ) : null}
        <span className="dense-toolbar__spacer" />
        <DensitySwitch value={density} onChange={setDensity} />
      </DenseToolbar>

      {tab === "regimes" && mismatchedRegimes.length > 0 ? (
        <DenseAlert
          action={
            <Button size="sm" variant="secondary" onClick={() => setAlertsOnly((current) => !current)}>
              {alertsOnly ? "Quitar filtro" : "Filtrar"}
            </Button>
          }
        >
          <strong>
            {mismatchedRegimes.length}{" "}
            {mismatchedRegimes.length === 1 ? "régimen tiene" : "regímenes tienen"} un organismo que no
            corresponde a su jurisdicción:
          </strong>{" "}
          {mismatchedRegimes.map((row) => (
            <span className="dense-chip" key={row.id}>
              {row.code}
            </span>
          ))}
        </DenseAlert>
      ) : null}

      <DenseWorkspace panelId="catalog-tab-panel" inspector={inspector}>
        {tableBody}
      </DenseWorkspace>

      <ActionDrawer
        isOpen={drawer === "authority"}
        onClose={() => setDrawer(null)}
        eyebrow="Catálogo fiscal del estudio"
        title="Nuevo organismo recaudador"
        description="La jurisdicción define el alcance en el que puede asignarse este organismo: ARCA recauda en Nación, las DGR en cada provincia y las direcciones de rentas en cada municipio."
      >
        <form
          className="study-form study-form--compact dense-form"
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
          <div className="ds-field dense-form__full">
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
          className="study-form study-form--compact dense-form"
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
          <div className="ds-field dense-form__full">
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
          {regimeForm.authorityId && regimeForm.jurisdictionId ? (
            <div className="dense-note dense-note--ok" role="status">
              <Icon name="check" size={14} />
              <span>
                Coherente:{" "}
                {matchingAuthorities.find((item) => item.id === regimeForm.authorityId)?.code ?? "el organismo"}{" "}
                recauda en {jurisdictionName(regimeForm.jurisdictionId)}.
              </span>
            </div>
          ) : null}
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
          className="study-form study-form--compact dense-form"
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
          <div className="ds-field dense-form__full">
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
          <div className="dense-form__full">
            <Field
              id="activity-source"
              label="Fuente"
              value={activityForm.source}
              onChange={(event) => setActivityForm({ ...activityForm, source: event.target.value })}
              placeholder="Opcional: norma, padrón o resolución (ej. CM03, Arba)"
              maxLength={200}
            />
          </div>
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
          {!activityForm.code.trim() ||
          !activityForm.name.trim() ||
          !activityForm.jurisdictionId ||
          !activityForm.validFrom ||
          !activityCodeValid ||
          !activityValidityValid ? (
            <p className="form-submit-hint" role="note">
              Completá código, nombre, jurisdicción y vigencia para poder crear la actividad.
            </p>
          ) : null}
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
            className="study-form study-form--compact dense-form"
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
            <div className="dense-form__full">
              <Field
                id="activity-edit-name"
                label="Nombre"
                value={activityForm.name}
                onChange={(event) => setActivityForm({ ...activityForm, name: event.target.value })}
                maxLength={200}
                required
              />
            </div>
            <div className="dense-form__full">
              <Field
                id="activity-edit-source"
                label="Fuente"
                value={activityForm.source}
                onChange={(event) => setActivityForm({ ...activityForm, source: event.target.value })}
                placeholder="Opcional: dejala vacía para quitar la fuente"
                maxLength={200}
              />
            </div>
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

      {deletingTarget ? (
        <DeletionDrawer
          isOpen
          path={deletingTarget.path}
          onClose={() => setDeletingTarget(null)}
          onDeleted={async () => {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["tax-authorities", firmId] }),
              queryClient.invalidateQueries({ queryKey: ["tax-regimes", firmId] }),
              queryClient.invalidateQueries({ queryKey: ["tax-activities-catalog", firmId] }),
              queryClient.invalidateQueries({ queryKey: ["tax-activities", firmId] }),
              queryClient.invalidateQueries({ queryKey: ["client-profile-activity-catalog", firmId] }),
              queryClient.invalidateQueries({ queryKey: ["tax-rule-packs", firmId] }),
            ]);
            setReceipt("El catálogo quedó eliminado y la auditoría del estudio conserva el registro de la acción.");
          }}
        />
      ) : null}
    </DensePage>
  );
}
