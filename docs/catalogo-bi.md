# Catálogo semántico BI — Contable

> Métricas, dimensiones y filtros allowlisted para el Copiloto BI.
> El planner propone `BiQueryPlanV1`; Node valida el catálogo y ejecuta consultas/servicios canónicos.
> No se permite SQL libre, query sobre archivos crudos ni que el catálogo físico o el tenant provengan del modelo.

## Contrato canónico

```ts
interface BiQueryPlanV1 {
  version: 1;
  clientId: string;
  fiscalPeriodId: string;
  metric: string;
  dimensions: string[];
  filters: Array<{
    field: string;
    operator: "eq" | "neq" | "in" | "gte" | "lte";
    value: string | string[];
  }>;
  comparison: "NONE" | "PREVIOUS_PERIOD" | "PREVIOUS_YEAR";
  limit: number;
}
```

## Métricas iniciales

Cada métrica define: unidad, signo, fuente, versión, dimensiones permitidas y filtros permitidos.

| Métrica | Unidad | Signo | Fuente | Dimensiones | Filtros |
|---|---|---|---|---|---|
| `revenue` | ARS | + | Ledger (cuentas de ingresos) | período, cuenta, contraparte | cuenta, contraparte, período |
| `costs` | ARS | − | Ledger (cuentas de costos) | período, cuenta, contraparte | cuenta, contraparte, período |
| `expenses` | ARS | − | Ledger (cuentas de gastos) | período, cuenta, contraparte | cuenta, contraparte, período |
| `result` | ARS | ± | Ledger (ingresos − costos − gastos) | período | período |
| `vat_position` | ARS | ± | IVA (débito − crédito) | período | período |
| `balances_by_group` | ARS | ± | Ledger (saldos por grupo) | grupo de cuenta | grupo |
| `pending_documents` | count | + | Documentos | estado, tipo, antigüedad | estado, tipo |
| `reconciliation_status` | count | + | Bancos | estado | estado |
| `close_progress` | % | + | Cierres | estado | estado |

## Dimensiones permitidas

| Dimensión | Valores |
|---|---|
| `period` | Período fiscal del cliente |
| `account` | Cuenta del plan |
| `account_group` | Grupo de cuenta (rubro) |
| `counterparty` | Contraparte |
| `document_type` | Tipo documental |
| `document_state` | Estado del documento |
| `bank_state` | Estado de conciliación |
| `close_state` | Estado del cierre |

## Filtros permitidos

| Campo | Operadores |
|---|---|
| `account` | `eq`, `in` |
| `account_group` | `eq`, `in` |
| `counterparty` | `eq`, `in` |
| `period` | `eq`, `in` |
| `document_type` | `eq`, `in` |
| `document_state` | `eq`, `in` |
| `bank_state` | `eq`, `in` |
| `close_state` | `eq`, `in` |

## Comparación

| Valor | Significado |
|---|---|
| `NONE` | Sin comparación |
| `PREVIOUS_PERIOD` | Comparar con período anterior |
| `PREVIOUS_YEAR` | Comparar con año anterior |

## Validación en Node

Node valida antes de ejecutar:

1. `metric` existe en el catálogo.
2. `dimensions` ⊆ dimensiones permitidas de la métrica.
3. `filters` ⊆ filtros permitidos de la métrica, con operadores válidos.
4. `comparison` ∈ {`NONE`, `PREVIOUS_PERIOD`, `PREVIOUS_YEAR`}.
5. `limit` ≤ máximo configurado.
6. `clientId` y `fiscalPeriodId` pertenecen al contexto autorizado.

Un plan inválido nunca ejecuta. No se envía SQL libre ni nombres físicos de tablas.

## Widgets

| Widget | Estados |
|---|---|
| `KPI` | LOADING, SUCCESS, EMPTY, ERROR, STALE |
| `LINE_CHART` | LOADING, SUCCESS, EMPTY, ERROR, STALE |
| `BAR_CHART` | LOADING, SUCCESS, EMPTY, ERROR, STALE |
| `DONUT_CHART` | LOADING, SUCCESS, EMPTY, ERROR, STALE |
| `TABLE` | LOADING, SUCCESS, EMPTY, ERROR, STALE |
| `COMPARISON` | LOADING, SUCCESS, EMPTY, ERROR, STALE |

Cada widget guarda plan, versión de métrica, cutoff, fuente y verificación. Los artefactos conversacionales son efímeros hasta que el usuario los fija.

## Pendiente de validación

- [ ] Confirmar el catálogo de métricas con el responsable de dominio.
- [ ] Confirmar dimensiones/filtros permitidos por métrica.
- [ ] Confirmar el mapeo de cada métrica a cuentas del plan.