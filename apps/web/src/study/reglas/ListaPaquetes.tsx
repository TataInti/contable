import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
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

  // Filas que entran completas en la tabla con su tope de alto. Si la última queda cortada, el pie
  // dice «N de M» en lugar de contar todos como visibles (P3, P4).
  const listaRef = useRef<HTMLDivElement>(null);
  const [visibles, setVisibles] = useState<number | null>(null);
  useLayoutEffect(() => {
    const scroll = listaRef.current?.querySelector<HTMLElement>(".dense-table-scroll");
    if (!scroll) {
      setVisibles(null);
      return;
    }
    const medir = () => {
      const cabecera =
        scroll.querySelector("thead")?.getBoundingClientRect().bottom ?? scroll.getBoundingClientRect().top;
      const fondo = scroll.getBoundingClientRect().bottom;
      const completas = Array.from(scroll.querySelectorAll<HTMLElement>("tbody tr")).filter((fila) => {
        const caja = fila.getBoundingClientRect();
        return caja.top >= cabecera - 1 && caja.bottom <= fondo + 1;
      }).length;
      setVisibles(completas);
    };
    medir();
    scroll.addEventListener("scroll", medir, { passive: true });
    window.addEventListener("resize", medir);
    return () => {
      scroll.removeEventListener("scroll", medir);
      window.removeEventListener("resize", medir);
    };
  }, [visiblePacks]);
  const contador =
    visibles !== null && visibles < visiblePacks.length
      ? `${visibles} de ${visiblePacks.length}`
      : visiblePacks.length;

  const versionsLabel = (pack: RulePack) => {
    const active = pack.versions.find((version) => version.status === "ACTIVE");
    const draft = pack.versions.find((version) => version.status === "DRAFT");
    const review = pack.versions.find((version) => version.status === "IN_REVIEW");
    const parts = [
      draft ? `Borrador v${draft.version}` : null,
      review ? `En revisión v${review.version}` : null,
      active ? `Vigente v${active.version}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "Sin versión vigente";
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
            <Button size="sm" variant="ghost" onClick={onClearFilter}>
              Filtro activo · quitar
            </Button>
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
          title="Todavía no hay paquetes de reglas"
          description="Creá un paquete para definir alícuotas, vencimientos y fuentes normativas."
        />
      ) : (
        <div className="dense-packs dense-packs--tope-siete-filas" ref={listaRef}>
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
                count={contador}
                noun={visiblePacks.length === 1 ? "paquete" : "paquetes"}
                hint={selectedPackId ? undefined : "Elegí un paquete para ver sus versiones y reglas."}
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
