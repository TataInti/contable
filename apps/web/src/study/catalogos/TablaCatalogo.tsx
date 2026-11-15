import type { ReactNode } from "react";
import { Button, EmptyState } from "@contable/design-system";
import { DenseLoading, DenseTable } from "../../ui/Dense";
import {
  columnasActividades,
  columnasJurisdicciones,
  columnasOrganismos,
  columnasRegimenes,
  columnasTiposImpuesto,
} from "./columnas";
import type {
  CatalogActivityRow,
  JurisdictionOption,
  TaxAuthorityRow,
  TaxRegimeRow,
  TaxTypeOption,
} from "./tipos";

interface VistaBase {
  cargando: boolean;
  error: boolean;
}

// Vista de la pestaña activa: la tabla decide entre carga, error, vacío y filas.
export type VistaPestana =
  | (VistaBase & { tab: "jurisdictions"; filas: JurisdictionOption[]; sinRegistros: boolean })
  | (VistaBase & { tab: "taxTypes"; filas: TaxTypeOption[]; sinRegistros: boolean })
  | (VistaBase & { tab: "authorities"; filas: TaxAuthorityRow[]; sinRegistros: boolean })
  | (VistaBase & { tab: "regimes"; filas: TaxRegimeRow[]; sinRegistros: boolean })
  | (VistaBase & { tab: "activities"; filas: CatalogActivityRow[]; filtrosActivos: boolean });

export interface DependenciasTabla {
  jurisdictions: JurisdictionOption[];
  jurisdictionName: (jurisdictionId: string) => string;
  jurisdictionParentLabel: (jurisdiction: JurisdictionOption) => string;
  regimesByAuthority: (authorityId: string) => TaxRegimeRow[];
  regimeMismatch: (row: TaxRegimeRow) => boolean;
  authorityJurisdictionName: (row: TaxRegimeRow) => string;
}

export type TablaCatalogoProps = VistaPestana & {
  selectedId: string | null;
  inspectorOpen: boolean;
  originKnown: boolean;
  select: (key: string | null) => void;
  tableFooter: ReactNode;
  dependencias: DependenciasTabla;
  onLimpiarFiltros: () => void;
};

export function TablaCatalogo(props: TablaCatalogoProps) {
  const { selectedId, inspectorOpen, originKnown, select, tableFooter, dependencias, onLimpiarFiltros } = props;

  if (props.tab === "jurisdictions") {
    if (props.cargando) return <DenseLoading label="Cargando jurisdicciones…" />;
    if (props.error) return null;
    return (
      <DenseTable<JurisdictionOption>
        label="Jurisdicciones"
        columns={columnasJurisdicciones({ jurisdictionParentLabel: dependencias.jurisdictionParentLabel })}
        rows={props.filas}
        rowKey={(row) => row.id}
        selectedKey={selectedId}
        onSelect={select}
        inspectorOpen={inspectorOpen}
        rowClassName={(row) => (row.isActive ? undefined : "dense-row--muted")}
        footer={tableFooter}
        empty={
          <EmptyState
            size="compact"
            kind={props.sinRegistros ? "no-data" : "no-results"}
            title={
              props.sinRegistros
                ? "Todavía no hay jurisdicciones"
                : "Ninguna jurisdicción coincide con los filtros"
            }
            description={
              props.sinRegistros
                ? "Creá Nación, provincia y municipio para completar el alcance fiscal del estudio."
                : "Probá con otro código o nombre, o quitá filtros."
            }
          />
        }
      />
    );
  }

  if (props.tab === "taxTypes") {
    if (props.cargando) return <DenseLoading label="Cargando tipos de impuesto…" />;
    if (props.error) return null;
    return (
      <DenseTable<TaxTypeOption>
        label="Tipos de impuesto"
        columns={columnasTiposImpuesto()}
        rows={props.filas}
        rowKey={(row) => row.id}
        selectedKey={selectedId}
        onSelect={select}
        inspectorOpen={inspectorOpen}
        rowClassName={(row) => (row.isActive ? undefined : "dense-row--muted")}
        footer={tableFooter}
        empty={
          <EmptyState
            size="compact"
            kind={props.sinRegistros ? "no-data" : "no-results"}
            title={
              props.sinRegistros
                ? "Todavía no hay tipos de impuesto"
                : "Ningún tipo de impuesto coincide con los filtros"
            }
            description={
              props.sinRegistros
                ? "Creá un tipo de impuesto para poder iniciar regímenes fiscales."
                : "Probá con otro código o nombre, o quitá filtros."
            }
          />
        }
      />
    );
  }

  if (props.tab === "authorities") {
    if (props.cargando) return <DenseLoading label="Cargando organismos recaudadores…" />;
    if (props.error) return null;
    return (
      <DenseTable<TaxAuthorityRow>
        label="Organismos recaudadores"
        columns={columnasOrganismos({ regimesByAuthority: dependencias.regimesByAuthority }).filter(
          (column) => originKnown || column.key !== "origin",
        )}
        rows={props.filas}
        rowKey={(row) => row.id}
        selectedKey={selectedId}
        onSelect={select}
        inspectorOpen={inspectorOpen}
        rowClassName={(row) => (row.isActive ? undefined : "dense-row--muted")}
        footer={tableFooter}
        empty={
          <EmptyState
            size="compact"
            kind={props.sinRegistros ? "no-data" : "no-results"}
            title={
              props.sinRegistros
                ? "Todavía no hay organismos recaudadores"
                : "Ningún organismo coincide con los filtros"
            }
            description={
              props.sinRegistros
                ? "Creá un organismo asociado a una jurisdicción para poder registrar regímenes."
                : "Probá con otro código o nombre, o quitá filtros."
            }
          />
        }
      />
    );
  }

  if (props.tab === "regimes") {
    if (props.cargando) return <DenseLoading label="Cargando regímenes…" />;
    if (props.error) return null;
    return (
      <DenseTable<TaxRegimeRow>
        label="Regímenes"
        columns={columnasRegimenes({
          regimeMismatch: dependencias.regimeMismatch,
          authorityJurisdictionName: dependencias.authorityJurisdictionName,
        }).filter((column) => originKnown || column.key !== "origin")}
        rows={props.filas}
        rowKey={(row) => row.id}
        selectedKey={selectedId}
        onSelect={select}
        inspectorOpen={inspectorOpen}
        rowClassName={(row) => (row.isActive ? undefined : "dense-row--muted")}
        footer={tableFooter}
        empty={
          <EmptyState
            size="compact"
            kind={props.sinRegistros ? "no-data" : "no-results"}
            title={
              props.sinRegistros ? "Todavía no hay regímenes fiscales" : "Ningún régimen coincide con los filtros"
            }
            description={
              props.sinRegistros
                ? "Definí un régimen con un organismo recaudador y jurisdicción verificados."
                : "Probá con otro código o nombre, o quitá filtros."
            }
          />
        }
      />
    );
  }

  if (props.cargando) return <DenseLoading label="Cargando actividades económicas…" />;
  if (props.error) return null;
  return (
    <DenseTable<CatalogActivityRow>
      label="Actividades económicas"
      columns={columnasActividades({
        jurisdictions: dependencias.jurisdictions,
        jurisdictionName: dependencias.jurisdictionName,
      }).filter((column) => originKnown || column.key !== "origin")}
      rows={props.filas}
      rowKey={(row) => row.id}
      selectedKey={selectedId}
      onSelect={select}
      inspectorOpen={inspectorOpen}
      rowClassName={(row) => (row.isActive ? undefined : "dense-row--muted")}
      footer={tableFooter}
      empty={
        <EmptyState
          size="compact"
          kind={props.filtrosActivos ? "no-results" : "no-data"}
          title={
            props.filtrosActivos
              ? "Ninguna actividad coincide con el filtro"
              : "Todavía no hay actividades económicas"
          }
          description={
            props.filtrosActivos
              ? "Ajustá los criterios de búsqueda o quitá el filtro."
              : "Creá una actividad para poder vincularla a clientes y reglas fiscales."
          }
          action={
            props.filtrosActivos ? (
              <Button type="button" variant="text" size="row" onClick={onLimpiarFiltros}>
                Quitar filtro
              </Button>
            ) : undefined
          }
        />
      }
    />
  );
}
