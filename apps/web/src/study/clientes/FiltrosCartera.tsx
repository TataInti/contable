import type { RefObject } from "react";
import { CLIENT_VAT_CONDITION_LABELS, CLIENT_VAT_CONDITIONS } from "@contable/contracts";
import { DenseSearch, DenseToggleGroup, DenseToolbar } from "../../ui/Dense";
import { CUIT_ENDINGS, parseEndingFilter } from "./terminacion";
import { BarSelect } from "@contable/design-system";

/** Criterios de la barra que, activos, reducen la cartera o cambian sus filas. */
export interface FiltrosActivos {
  search: string;
  statusFilter: string;
  vatFilter: string;
  onlyIncomplete: boolean;
  endingFilter: string[];
}

export function hasActiveFilters({ search, statusFilter, vatFilter, onlyIncomplete, endingFilter }: FiltrosActivos): boolean {
  return search.trim() !== "" || statusFilter !== "" || vatFilter !== "" || onlyIncomplete || endingFilter.length > 0;
}

interface FiltrosCarteraProps {
  search: string;
  setSearch: (valor: string) => void;
  statusFilter: string;
  setStatusFilter: (valor: string) => void;
  vatFilter: string;
  setVatFilter: (valor: string) => void;
  endingFilter: string[];
  setEndingFilter: (digitos: string[]) => void;
  grouped: boolean;
  setGrouping: (activa: boolean) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}

export function FiltrosCartera({
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  vatFilter,
  setVatFilter,
  endingFilter,
  setEndingFilter,
  grouped,
  setGrouping,
  searchRef,
}: FiltrosCarteraProps) {
  return (
    <DenseToolbar>
      <DenseSearch
        inputRef={searchRef}
        value={search}
        onChange={setSearch}
        placeholder="Buscar por nombre o CUIT…"
        label="Buscar clientes"
      />
      <BarSelect
        label="Filtrar por estado"
        value={statusFilter}
        onChange={(event) => setStatusFilter(event.target.value)}
        options={[
          { value: "", label: "Todos los estados" },
          { value: "ACTIVE", label: "Activos" },
          { value: "INACTIVE", label: "Inactivos" },
        ]}
      />
      <BarSelect
        label="Filtrar por condición IVA"
        value={vatFilter}
        onChange={(event) => setVatFilter(event.target.value)}
        options={[
          { value: "", label: "Todas las condiciones" },
          ...CLIENT_VAT_CONDITIONS.map((value) => ({ value, label: CLIENT_VAT_CONDITION_LABELS[value] })),
        ]}
      />
      <BarSelect
        label="Terminación de CUIT"
        value={endingFilter.join(",")}
        onChange={(event) => setEndingFilter(parseEndingFilter(event.target.value))}
        options={[
          { value: "", label: "Toda terminación de CUIT" },
          ...(endingFilter.length > 1 ? [{ value: endingFilter.join(","), label: `Terminaciones ${endingFilter.join(", ")}` }] : []),
          ...CUIT_ENDINGS.map((digit) => ({ value: digit, label: `Termina en ${digit}` })),
        ]}
      />
      <DenseToggleGroup
        label="Agrupación de la lista"
        options={[{ value: "terminacion", label: "Agrupar por terminación" }]}
        selected={grouped ? ["terminacion"] : []}
        onChange={(next) => setGrouping(next.includes("terminacion"))}
      />
    </DenseToolbar>
  );
}
