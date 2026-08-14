import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, Table } from "@contable/design-system";
import { api, type Account, type TrialBalance } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import "./study.css";

interface JournalLine {
  accountId: string;
  description?: string | null;
  debitFunctional: string;
  creditFunctional: string;
}

interface JournalRow {
  id: string;
  sequenceNumber: number | null;
  entryDate: string;
  description: string;
  status: string;
  lines: JournalLine[];
}

interface LedgerResponse {
  balances: { accountId: string; debitTotal: string; creditTotal: string; balance: string }[];
  totals: { debitTotal: string; creditTotal: string };
}

type LedgerView = "journal" | "ledger" | "trial-balance";

const MONEY = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
});
const DATE = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" });

function money(value: string | number | undefined) {
  return MONEY.format(Number(value ?? 0));
}

export function StudyContabilidad() {
  const { firmId, clientId, periodId } = useClientContext();
  const [view, setView] = useState<LedgerView>("journal");
  const [accountId, setAccountId] = useState("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const base = firmId && clientId ? `/firms/${firmId}/clients/${clientId}` : null;

  const accounts = useQuery({
    queryKey: ["accounts", firmId, clientId],
    queryFn: () => api.get<Account[]>(`${base}/accounts`),
    enabled: Boolean(base),
  });
  const journal = useQuery({
    queryKey: ["ledger-journal", firmId, clientId, periodId],
    queryFn: () =>
      api.get<JournalRow[]>(
        `${base}/ledger/journal${periodId ? `?periodId=${encodeURIComponent(periodId)}` : ""}`,
      ),
    enabled: Boolean(base && periodId && view === "journal"),
  });
  const ledger = useQuery({
    queryKey: ["ledger-balances", firmId, clientId, accountId],
    queryFn: () =>
      api.get<LedgerResponse>(
        `${base}/ledger/ledger${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`,
      ),
    enabled: Boolean(base && view === "ledger"),
  });
  const trialBalance = useQuery({
    queryKey: ["trial-balance", firmId, clientId, periodId],
    queryFn: () =>
      api.get<TrialBalance>(
        `${base}/ledger/trial-balance${periodId ? `?periodId=${encodeURIComponent(periodId)}` : ""}`,
      ),
    enabled: Boolean(base && periodId && view === "trial-balance"),
  });

  const accountMap = useMemo(
    () => new Map((accounts.data ?? []).map((account) => [account.id, account])),
    [accounts.data],
  );
  const journalRows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es-AR");
    if (!needle) return journal.data ?? [];
    return (journal.data ?? []).filter(
      (entry) =>
        entry.description.toLocaleLowerCase("es-AR").includes(needle) ||
        entry.lines.some((line) =>
          accountMap.get(line.accountId)?.name.toLocaleLowerCase("es-AR").includes(needle),
        ),
    );
  }, [accountMap, journal.data, search]);

  if (!base)
    return (
      <div className="study-page">
        <EmptyState
          title="Seleccioná un cliente"
          description="Los libros siempre se consultan dentro de un cliente específico."
        />
      </div>
    );

  const activeQuery = view === "journal" ? journal : view === "ledger" ? ledger : trialBalance;

  return (
    <div className="study-page study-page--wide">
      <div className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Libros canónicos</p>
          <h1 className="study-page__title">Contabilidad</h1>
          <p className="study-page__subtitle">
            Consultá asientos contabilizados, movimientos por cuenta y el balance del período
            activo.
          </p>
        </div>
        <Button variant="secondary" onClick={() => window.print()}>
          <Icon name="file" size={17} /> Imprimir vista
        </Button>
      </div>

      <div className="ledger-tabs" role="tablist" aria-label="Vistas contables">
        {(
          [
            ["journal", "Diario"],
            ["ledger", "Mayor"],
            ["trial-balance", "Sumas y saldos"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={`ledger-tabs__item${view === id ? " ledger-tabs__item--active" : ""}`}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ledger-toolbar">
        <div className="ledger-toolbar__copy">
          <span className="ledger-toolbar__icon">
            <Icon name={view === "journal" ? "file" : "chart"} size={18} />
          </span>
          <span>
            <strong>
              {view === "journal"
                ? "Libro diario"
                : view === "ledger"
                  ? "Libro mayor"
                  : "Balance de sumas y saldos"}
            </strong>
            <small>
              {view === "ledger"
                ? "Saldos acumulados por cuenta"
                : "Sólo incluye asientos contabilizados"}
            </small>
          </span>
        </div>
        {view === "journal" ? (
          <label className="ledger-search">
            <span className="sr-only">Buscar en el diario</span>
            <Icon name="search" size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar descripción o cuenta"
            />
          </label>
        ) : null}
        {view === "ledger" ? (
          <label className="ledger-account-filter">
            <span>Cuenta</span>
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Todas las cuentas</option>
              {(accounts.data ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {activeQuery.isLoading ? (
        <div className="query-state" role="status">
          <span className="loading-copy">Preparando el libro…</span>
        </div>
      ) : activeQuery.isError ? (
        <EmptyState
          title="No se pudo cargar esta vista"
          description="Revisá el contexto seleccionado o reintentá en unos minutos."
          action={
            <Button variant="secondary" onClick={() => void activeQuery.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : null}

      {!activeQuery.isLoading && !activeQuery.isError && view === "journal" ? (
        <section className="ledger-surface" aria-label="Libro diario">
          {journalRows.length === 0 ? (
            <EmptyState
              title={search ? "No hay coincidencias" : "El diario está vacío"}
              description={
                search
                  ? "Probá con otro término de búsqueda."
                  : "Cuando se contabilice el primer asiento del período aparecerá acá."
              }
            />
          ) : (
            <Table
              rows={journalRows}
              rowKey={(entry) => entry.id}
              columns={[
                {
                  key: "number",
                  header: "Asiento",
                  render: (entry) => (
                    <button
                      className="ledger-entry-link"
                      aria-expanded={expandedId === entry.id}
                      onClick={() =>
                        setExpandedId((current) => (current === entry.id ? null : entry.id))
                      }
                    >
                      #{entry.sequenceNumber ?? "—"}
                      <Icon name="chevron" size={13} />
                    </button>
                  ),
                },
                {
                  key: "date",
                  header: "Fecha",
                  render: (entry) => DATE.format(new Date(entry.entryDate)),
                },
                {
                  key: "description",
                  header: "Descripción",
                  render: (entry) => (
                    <div className="ledger-description">
                      <strong>{entry.description}</strong>
                      {expandedId === entry.id ? (
                        <div className="ledger-lines">
                          {entry.lines.map((line, index) => (
                            <div key={`${line.accountId}-${index}`}>
                              <span>
                                {accountMap.get(line.accountId)?.code} ·{" "}
                                {accountMap.get(line.accountId)?.name ?? "Cuenta"}
                              </span>
                              <span>
                                {Number(line.debitFunctional) > 0
                                  ? `Debe ${money(line.debitFunctional)}`
                                  : `Haber ${money(line.creditFunctional)}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: "debit",
                  header: "Debe",
                  align: "right",
                  render: (entry) =>
                    money(entry.lines.reduce((sum, line) => sum + Number(line.debitFunctional), 0)),
                },
                {
                  key: "credit",
                  header: "Haber",
                  align: "right",
                  render: (entry) =>
                    money(
                      entry.lines.reduce((sum, line) => sum + Number(line.creditFunctional), 0),
                    ),
                },
                {
                  key: "status",
                  header: "Estado",
                  render: (entry) => <StatusBadge status={entry.status} />,
                },
              ]}
            />
          )}
        </section>
      ) : null}

      {!activeQuery.isLoading && !activeQuery.isError && view === "ledger" ? (
        <section className="ledger-surface" aria-label="Libro mayor">
          {(ledger.data?.balances.length ?? 0) === 0 ? (
            <EmptyState
              title="Sin movimientos contabilizados"
              description="Elegí otra cuenta o verificá que existan asientos contabilizados."
            />
          ) : (
            <>
              <Table
                rows={ledger.data?.balances ?? []}
                rowKey={(row) => row.accountId}
                columns={[
                  {
                    key: "code",
                    header: "Código",
                    render: (row) => accountMap.get(row.accountId)?.code ?? "—",
                  },
                  {
                    key: "account",
                    header: "Cuenta",
                    render: (row) =>
                      accountMap.get(row.accountId)?.name ?? row.accountId.slice(0, 8),
                  },
                  {
                    key: "debit",
                    header: "Débitos",
                    align: "right",
                    render: (row) => money(row.debitTotal),
                  },
                  {
                    key: "credit",
                    header: "Créditos",
                    align: "right",
                    render: (row) => money(row.creditTotal),
                  },
                  {
                    key: "balance",
                    header: "Saldo",
                    align: "right",
                    render: (row) => <strong>{money(row.balance)}</strong>,
                  },
                ]}
              />
              <div className="ledger-totals">
                <span>Totales del mayor</span>
                <strong>Debe {money(ledger.data?.totals.debitTotal)}</strong>
                <strong>Haber {money(ledger.data?.totals.creditTotal)}</strong>
              </div>
            </>
          )}
        </section>
      ) : null}

      {!activeQuery.isLoading && !activeQuery.isError && view === "trial-balance" ? (
        <section className="ledger-surface" aria-label="Balance de sumas y saldos">
          {(trialBalance.data?.lines.length ?? 0) === 0 ? (
            <EmptyState
              title="Sin saldos para este período"
              description="Los saldos aparecerán cuando existan movimientos contabilizados."
            />
          ) : (
            <>
              <Table
                rows={trialBalance.data?.lines ?? []}
                rowKey={(row) => row.accountId}
                columns={[
                  { key: "code", header: "Código", render: (row) => row.accountCode },
                  { key: "account", header: "Cuenta", render: (row) => row.accountName },
                  {
                    key: "debit",
                    header: "Sumas deudoras",
                    align: "right",
                    render: (row) => money(row.debitTotal),
                  },
                  {
                    key: "credit",
                    header: "Sumas acreedoras",
                    align: "right",
                    render: (row) => money(row.creditTotal),
                  },
                  {
                    key: "balance",
                    header: "Saldo",
                    align: "right",
                    render: (row) => <strong>{money(row.balance)}</strong>,
                  },
                ]}
              />
              <div className="ledger-totals">
                <span>Control del período</span>
                <strong>Debe {money(trialBalance.data?.totals.debitTotal)}</strong>
                <strong>Haber {money(trialBalance.data?.totals.creditTotal)}</strong>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
