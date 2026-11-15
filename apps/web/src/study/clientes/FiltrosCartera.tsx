import type { RefObject } from "react";
import { CLIENT_VAT_CONDITION_LABELS, CLIENT_VAT_CONDITIONS } from "@contable/contracts";
import { DenseSearch, DenseToggleGroup, DenseToolbar } from "../../ui/Dense";
import { CUIT_ENDINGS } from "./terminacion";

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
      <span className="dense-dim">Terminación de CUIT</span>
      <DenseToggleGroup
        label="Terminación de CUIT"
        options={CUIT_ENDINGS.map((digit) => ({ value: digit, label: digit }))}
        selected={endingFilter}
        onChange={setEndingFilter}
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
