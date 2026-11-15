import { useMemo, type RefObject } from "react";
import { AsyncState, Button, EmptyState } from "@contable/design-system";
import { DenseFooter, DenseSearch, DenseTable, DenseToolbar, normalizeSearch, type DenseColumn } from "../../ui/Dense";
import type { RulePack } from "./tipos";

type PackFilter = "" | "ACTIVE" | "DRAFT" | "IN_REVIEW";

interface ListaPaquetesProps {
  packs: RulePack[];
  isLoading: boolean;
  isEmpty: boolean;
  isError: boolean;
  onRetry: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  filter: PackFilter;
  onClearFilter: () => void;
  selectedPackId: string | null;
  onSelectPack: (packId: string) => void;
  canPropose: boolean;
}

export function ListaPaquetes({
  packs,
  isLoading,
  isEmpty,
  isError,
  onRetry,
  search,
  onSearchChange,
  searchRef,
  filter,
  onClearFilter,
  selectedPackId,
  onSelectPack,
  canPropose,
}: ListaPaquetesProps) {
  const visiblePacks = useMemo(() => {
    const needle = normalizeSearch(search);
    return packs.filter((pack) => {
      if (filter && !pack.versions.some((version) => version.status === filter)) return false;
      if (!needle) return true;
      return normalizeSearch(
        `${pack.name} ${pack.code} ${pack.regime.taxType.name} ${pack.regime.jurisdiction.name}`,
      ).includes(needle);
    });
  }, [packs, filter, search]);

  const quitarFiltros = () => {
    onSearchChange("");
    onClearFilter();
  };

  const versionsLabel = (pack: RulePack) => {
    const active = pack.versions.find((version) => version.status === "ACTIVE");
    const draft = pack.versions.find((version) => version.status === "DRAFT");
    const review = pack.versions.find((version) => version.status === "IN_REVIEW");
    const parts = [
      draft ? `Borrador v${draft.version}` : null,
      review ? `En revisión v${review.version}` : null,
      active ? `Vigente v${active.version}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "Sin versión activa";
  };
  const packColumns: DenseColumn<RulePack>[] = [
    {
      key: "name",
      header: "Paquete",
      sortValue: (pack) => pack.name.toLocaleLowerCase("es-AR"),
      render: (pack) => (
        <span className="dense-name">
          <span className="dense-name__text">
            <strong>{pack.name}</strong>
            <small>{pack.code} · {pack.regime.name}{!pack.regime.isActive ? " (oculto)" : ""}</small>
          </span>
        </span>
      ),
    },
    {
      key: "tax",
      header: "Impuesto",
      sortValue: (pack) => pack.regime.taxType.name,
      render: (pack) => `${pack.regime.taxType.name}${!pack.regime.taxType.isActive ? " (oculto)" : ""}`,
    },
    {
      key: "jurisdiction",
      header: "Jurisdicción",
      sortValue: (pack) => pack.regime.jurisdiction.name,
      render: (pack) => `${pack.regime.jurisdiction.name}${!pack.regime.jurisdiction.isActive ? " (oculto)" : ""}`,
    },
    {
      key: "versions",
      header: "Versiones",
      render: (pack) => <span>{versionsLabel(pack)}</span>,
    },
  ];

  return (
    <>
      {!isEmpty && !isError ? (
        <DenseToolbar>
          <DenseSearch
            inputRef={searchRef}
            value={search}
            onChange={onSearchChange}
            placeholder="Buscar paquete, impuesto o jurisdicción…"
            label="Buscar paquetes"
          />
          {filter ? (
            <button type="button" className="dense-toggle" aria-pressed onClick={onClearFilter}>
              Filtro activo · quitar
            </button>
          ) : null}
          <span className="dense-toolbar__spacer" />
        </DenseToolbar>
      ) : null}

      {isLoading || isError ? (
        <AsyncState
          loading={isLoading}
          error={isError}
          loadingLabel="Cargando reglas…"
          errorTitle="No se pudo cargar la lista de paquetes"
          errorDescription="Reintentá la consulta para volver a ver los paquetes de reglas."
          onRetry={onRetry}
        />
      ) : isEmpty ? (
        <EmptyState
          size="compact"
          className="fiscal-rules-empty"
          title="Todavía no hay paquetes de reglas"
          description="Creá un paquete para definir alícuotas, vencimientos y fuentes normativas."
        />
      ) : (
        <div className="dense-packs">
          <DenseTable<RulePack>
            label="Paquetes de reglas disponibles"
            columns={packColumns}
            rows={visiblePacks}
            rowKey={(pack) => pack.id}
            selectedKey={selectedPackId}
            onSelect={(key) => {
              if (key) onSelectPack(key);
            }}
            footer={
              <DenseFooter
                count={visiblePacks.length}
                noun={visiblePacks.length === 1 ? "paquete" : "paquetes"}
                hint="Elegí un paquete para ver sus versiones y reglas."
                newShortcut={canPropose}
              />
            }
            empty={
              <EmptyState
                size="compact"
                kind="no-results"
                title="Ningún paquete coincide"
                description="Quitá los filtros o cambiá la búsqueda para ver otros paquetes."
                action={<Button size="sm" variant="secondary" onClick={quitarFiltros}>Quitar filtros</Button>}
              />
            }
          />
        </div>
      )}
    </>
  );
}
