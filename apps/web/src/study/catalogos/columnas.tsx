import type { DenseColumn } from "../../ui/Dense";
import { Icon } from "../../ui/Icon";
import { ActiveBadge, ActivityStateBadge, OriginBadge } from "./piezas";
import type { CatalogActivityRow, JurisdictionOption, TaxAuthorityRow, TaxRegimeRow, TaxTypeOption } from "./tipos";
import { jurisdictionKindLabel, validityLabel } from "./utilidades";

export function columnasOrganismos({ regimesByAuthority }: { regimesByAuthority: (authorityId: string) => TaxRegimeRow[] }): DenseColumn<TaxAuthorityRow>[] {
  return [
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
}

export function columnasRegimenes({ regimeMismatch, authorityJurisdictionName }: { regimeMismatch: (row: TaxRegimeRow) => boolean; authorityJurisdictionName: (row: TaxRegimeRow) => string }): DenseColumn<TaxRegimeRow>[] {
  return [
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
}

export function columnasActividades({ jurisdictions, jurisdictionName }: { jurisdictions: JurisdictionOption[]; jurisdictionName: (jurisdictionId: string) => string }): DenseColumn<CatalogActivityRow>[] {
  return [
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
      render: (row) => {
        const jurisdiction = jurisdictions.find((item) => item.id === row.jurisdictionId);
        return (
          <span className="dense-activity-jurisdiction" title={jurisdictionName(row.jurisdictionId)}>
            <span>{jurisdiction?.name ?? "—"}</span>
            {jurisdiction ? (
              <small>
                {jurisdictionKindLabel[jurisdiction.kind]} · {jurisdiction.code}
                {!jurisdiction.isActive ? " (oculta)" : ""}
              </small>
            ) : null}
          </span>
        );
      },
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
      render: (row) => validityLabel(row.validFrom, row.validTo),
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
}

export function columnasJurisdicciones({ jurisdictionParentLabel }: { jurisdictionParentLabel: (jurisdiction: JurisdictionOption) => string }): DenseColumn<JurisdictionOption>[] {
  return [
    {
      key: "code",
      header: "Código",
      sortValue: (row) => row.code,
      render: (row) => <span className="dense-code">{row.code}</span>,
    },
    {
      key: "name",
      header: "Jurisdicción",
      sortValue: (row) => row.name,
      render: (row) => <span title={row.name}>{row.name}</span>,
    },
    {
      key: "kind",
      header: "Nivel",
      sortValue: (row) => jurisdictionKindLabel[row.kind],
      render: (row) => jurisdictionKindLabel[row.kind],
    },
    {
      key: "parent",
      header: "Padre",
      sortValue: jurisdictionParentLabel,
      render: jurisdictionParentLabel,
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
}

export function columnasTiposImpuesto(): DenseColumn<TaxTypeOption>[] {
  return [
    {
      key: "code",
      header: "Código",
      sortValue: (row) => row.code,
      render: (row) => <span className="dense-code">{row.code}</span>,
    },
    {
      key: "name",
      header: "Tipo de impuesto",
      sortValue: (row) => row.name,
      render: (row) => <span title={row.name}>{row.name}</span>,
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
}
