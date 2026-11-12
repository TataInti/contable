import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, MoneyField, Table } from "@contable/design-system";
import { api, type Account, type FiscalYear, type TrialBalance } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { ActionDrawer } from "../ui/ActionDrawer";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import {
  DenseHeader,
  DensePage,
  StatStrip,
  useDensity,
} from "../ui/Dense";
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

interface DraftEntry {
  id: string;
  periodId: string;
  description: string;
  entryDate: string;
  status: string;
}

interface AccountingFiscalYear extends FiscalYear {
  status: string;
}

interface PostingAccount extends Account {
  isPostable?: boolean;
  isActive?: boolean;
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
  const [density] = useDensity();
  const { firmId, clientId, periodId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const [view, setView] = useState<LedgerView>("journal");
  const [accountId, setAccountId] = useState("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showDraftForm, setShowDraftForm] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    entryDate: "",
    description: "",
    reference: "",
    debitAccountId: "",
    creditAccountId: "",
    amount: "",
  });
  const base = firmId && clientId ? `/firms/${firmId}/clients/${clientId}` : null;
  const fiscalYears = useQuery({
    queryKey: ["fiscal-years", firmId, clientId],
    queryFn: () => api.get<AccountingFiscalYear[]>(`${base}/fiscal-years`),
    enabled: Boolean(base),
  });

  const accounts = useQuery({
    queryKey: ["accounts", firmId, clientId],
    queryFn: () => api.get<PostingAccount[]>(`${base}/accounts`),
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
  const drafts = useQuery({
    queryKey: ["journal-entries", firmId, clientId],
    queryFn: () => api.get<DraftEntry[]>(`${base}/journal-entries`),
    enabled: Boolean(base),
  });

  const accountMap = useMemo(
    () => new Map((accounts.data ?? []).map((account) => [account.id, account])),
    [accounts.data],
  );
  const postingAccounts = useMemo(
    () =>
      (accounts.data ?? []).filter(
        (account) => account.isPostable !== false && account.isActive !== false,
      ),
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
  const activeFiscalYear = useMemo(
    () => fiscalYears.data?.find((year) => year.periods.some((period) => period.id === periodId)),
    [fiscalYears.data, periodId],
  );
  const activePeriod = activeFiscalYear?.periods.find((period) => period.id === periodId);
  const selectedDrafts = useMemo(
    () =>
      (drafts.data ?? []).filter(
        (entry) => entry.periodId === periodId && ["DRAFT", "REJECTED"].includes(entry.status),
      ),
    [drafts.data, periodId],
  );
  const canCreateDraft =
    capabilities.has("entry.create") &&
    Boolean(activeFiscalYear && activeFiscalYear.status === "OPEN" && periodId) &&
    activePeriod?.status === "OPEN" &&
    postingAccounts.length >= 2;

  useEffect(() => {
    if (!activePeriod?.startDate || !activePeriod.endDate) return;
    const start = activePeriod.startDate.slice(0, 10);
    const end = activePeriod.endDate.slice(0, 10);
    setDraft((current) => {
      if (current.entryDate && current.entryDate >= start && current.entryDate <= end)
        return current;
      return { ...current, entryDate: start };
    });
  }, [activePeriod?.endDate, activePeriod?.id, activePeriod?.startDate]);

  const createDraft = useMutation({
    mutationFn: () => {
      if (!base || !periodId || !activeFiscalYear) {
        throw new Error("Seleccioná un período contable para crear el asiento.");
      }
      const amount = Number(draft.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Ingresá un importe mayor a cero.");
      }
      if (draft.debitAccountId === draft.creditAccountId) {
        throw new Error("Elegí cuentas distintas para el debe y el haber.");
      }
      const formattedAmount = amount.toFixed(2);
      return api.post(`${base}/journal-entries`, {
        fiscalYearId: activeFiscalYear.id,
        periodId,
        entryDate: draft.entryDate,
        postingDate: draft.entryDate,
        description: draft.description.trim(),
        ...(draft.reference.trim() ? { reference: draft.reference.trim() } : {}),
        sourceType: "MANUAL",
        lines: [
          {
            accountId: draft.debitAccountId,
            description: draft.description.trim(),
            currencyCode: "ARS",
            debitOriginal: formattedAmount,
            creditOriginal: "0",
            debitFunctional: formattedAmount,
            creditFunctional: "0",
          },
          {
            accountId: draft.creditAccountId,
            description: draft.description.trim(),
            currencyCode: "ARS",
            debitOriginal: "0",
            creditOriginal: formattedAmount,
            debitFunctional: "0",
            creditFunctional: formattedAmount,
          },
        ],
      });
    },
    onSuccess: () => {
      setShowDraftForm(false);
      setReceipt("Borrador creado y balanceado. Enviálo a revisión cuando esté listo.");
      setDraft((current) => ({
        ...current,
        description: "",
        reference: "",
        debitAccountId: "",
        creditAccountId: "",
        amount: "",
      }));
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["journal-entries", firmId, clientId] }),
        queryClient.invalidateQueries({ queryKey: ["ledger-journal", firmId, clientId, periodId] }),
      ]);
    },
  });
  const submitDraft = useMutation({
    mutationFn: (entryId: string) => api.post(`${base}/journal-entries/${entryId}/submit`),
    onSuccess: () => {
      setReceipt("Asiento enviado a revisión.");
      void queryClient.invalidateQueries({ queryKey: ["journal-entries", firmId, clientId] });
    },
  });

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
    <DensePage density={density} flow>
      <DenseHeader
        eyebrow="Libros canónicos"
        title="Contabilidad"
        description="Consultá asientos contabilizados, movimientos por cuenta y el balance del período activo."
        actions={
          <>
          <Button
            variant="ghost"
            onClick={() => {
              void (view === "journal"
                ? journal.refetch()
                : view === "ledger"
                  ? ledger.refetch()
                  : trialBalance.refetch());
            }}
          >
            Actualizar
          </Button>
          {capabilities.has("entry.create") ? (
            <Button
              onClick={() => setShowDraftForm((value) => !value)}
              variant={showDraftForm ? "secondary" : "primary"}
              disabled={!canCreateDraft}
              title={
                !activeFiscalYear
                  ? "Seleccioná un período contable para crear el asiento"
                  : activeFiscalYear.status !== "OPEN"
                    ? "El ejercicio contable está cerrado"
                    : activePeriod?.status !== "OPEN"
                      ? "El período contable está cerrado"
                      : postingAccounts.length < 2
                        ? "Se necesitan al menos dos cuentas activas y posteables para crear un asiento"
                        : undefined
              }
            >
              <Icon name={showDraftForm ? "close" : "plus"} size={17} />
              {showDraftForm ? "Cancelar asiento" : "Nuevo asiento"}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => window.print()}>
            <Icon name="file" size={17} /> Imprimir vista
          </Button>
        
          </>
        }
      />

      <StatStrip
        label="Resumen contable"
        items={[
          { key: "posted", label: "Asientos contabilizados", value: journal.data?.length ?? "—" },
          {
            key: "drafts",
            label: "En preparación",
            value: selectedDrafts.length,
            tone: selectedDrafts.length > 0 ? "warn" : undefined,
          },
          { key: "accounts", label: "Cuentas", value: accounts.data?.length ?? "—", detail: `${postingAccounts.length} posteables` },
          {
            key: "period",
            label: "Período",
            value: activePeriod ? (activePeriod.status === "OPEN" ? "Abierto" : "Cerrado") : "Sin seleccionar",
          },
        ]}
      />



      {receipt ? (
        <div className="action-receipt action-receipt--page" role="status">
          <Icon name="check" size={19} />
          <span>
            <strong>Acción completada</strong>
            <small>{receipt}</small>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Cerrar confirmación"
            onClick={() => setReceipt(null)}
          >
            <Icon name="close" size={15} />
          </Button>
        </div>
      ) : null}

      <ActionDrawer
        isOpen={showDraftForm}
        onClose={() => setShowDraftForm(false)}
        eyebrow="Maker"
        title="Nuevo asiento manual"
        description="Genera dos líneas balanceadas. Podrás enviarlo a revisión antes de contabilizar."
        size="wide"
      >
        <form
          className="study-form"
          onSubmit={(event) => {
            event.preventDefault();
            createDraft.mutate();
          }}
        >
          <Field
            id="entry-date"
            label="Fecha del asiento"
            type="date"
            value={draft.entryDate}
            min={activePeriod?.startDate.slice(0, 10)}
            max={activePeriod?.endDate.slice(0, 10)}
            onChange={(event) => setDraft({ ...draft, entryDate: event.target.value })}
            required
          />
          <Field
            id="entry-description"
            label="Descripción"
            value={draft.description}
            maxLength={500}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            placeholder="Ej. Devengamiento de honorarios"
            required
          />
          <Field
            id="entry-reference"
            label="Referencia"
            value={draft.reference}
            maxLength={200}
            onChange={(event) => setDraft({ ...draft, reference: event.target.value })}
            placeholder="Opcional"
          />
          <label className="ds-field" htmlFor="entry-debit-account">
            <span className="ds-field__label">Cuenta deudora</span>
            <select
              id="entry-debit-account"
              className="ctxbar__input"
              value={draft.debitAccountId}
              onChange={(event) => setDraft({ ...draft, debitAccountId: event.target.value })}
              required
            >
              <option value="">Elegí una cuenta</option>
              {postingAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ds-field" htmlFor="entry-credit-account">
            <span className="ds-field__label">Cuenta acreedora</span>
            <select
              id="entry-credit-account"
              className="ctxbar__input"
              value={draft.creditAccountId}
              onChange={(event) => setDraft({ ...draft, creditAccountId: event.target.value })}
              required
            >
              <option value="">Elegí una cuenta</option>
              {postingAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
          </label>
          <MoneyField
            id="entry-amount"
            label="Importe ARS"
            value={draft.amount}
            onChange={(value) => setDraft({ ...draft, amount: value })}
            required
          />
          {createDraft.isError ? (
            <p className="form-error study-form__actions" role="alert">
              {createDraft.error.message}
            </p>
          ) : null}
          <div className="study-form__actions">
            <span className="study-page__hint">Debe y haber se generan por el mismo importe.</span>
            <Button
              type="submit"
              loading={createDraft.isPending}
              disabled={
                !draft.entryDate ||
                !draft.description.trim() ||
                !draft.debitAccountId ||
                !draft.creditAccountId ||
                !draft.amount ||
                !canCreateDraft
              }
            >
              Guardar borrador
            </Button>
          </div>
        </form>
      </ActionDrawer>

      <div className="ledger-tabs" role="tablist" aria-label="Vistas contables">
        {(
          [
            ["journal", "Diario"],
            ["ledger", "Mayor"],
            ["trial-balance", "Sumas y saldos"],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            type="button"
            variant="ghost"
            size="row"
            role="tab"
            aria-selected={view === id}
            className={`ledger-tabs__item${view === id ? " ledger-tabs__item--active" : ""}`}
            onClick={() => setView(id)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="ledger-toolbar" id="accounting-views-title">
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

      <section className="study-panel" aria-labelledby="drafts-title">
        <div className="study-panel__heading">
          <div>
            <p className="study-page__eyebrow">Maker</p>
            <h2 id="drafts-title">Asientos en preparación</h2>
            <p>
              Los borradores no afectan los libros hasta completar la revisión y contabilización.
            </p>
          </div>
          <span className="section-count">{selectedDrafts.length}</span>
        </div>
        {drafts.isLoading ? (
          <div className="query-state query-state--compact" role="status">
            <span className="loading-copy">Cargando borradores…</span>
          </div>
        ) : drafts.isError ? (
          <EmptyState
            size="compact"
            title="No se pudieron cargar los borradores"
            action={
              <Button size="sm" variant="secondary" onClick={() => void drafts.refetch()}>
                Reintentar
              </Button>
            }
          />
        ) : selectedDrafts.length === 0 ? (
          <EmptyState
            size="compact"
            title="No hay asientos en preparación"
            description="Creá un borrador para iniciar el circuito maker–checker."
            action={
              canCreateDraft ? (
                <Button size="sm" variant="secondary" onClick={() => setShowDraftForm(true)}>
                  Crear asiento
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table
            rows={selectedDrafts}
            rowKey={(entry) => entry.id}
            columns={[
              {
                key: "date",
                header: "Fecha",
                render: (entry) => DATE.format(new Date(entry.entryDate)),
              },
              {
                key: "description",
                header: "Descripción",
                render: (entry) => <strong>{entry.description}</strong>,
              },
              {
                key: "status",
                header: "Estado",
                render: (entry) => <StatusBadge status={entry.status} />,
              },
              {
                key: "actions",
                header: "Próximo paso",
                align: "right",
                render: (entry) =>
                  entry.status === "DRAFT" && capabilities.has("entry.submit") ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={submitDraft.isPending}
                      onClick={() => submitDraft.mutate(entry.id)}
                    >
                      Enviar a revisión
                    </Button>
                  ) : entry.status === "REJECTED" && capabilities.has("entry.create") ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setDraft((current) => ({
                          ...current,
                          description: `Corrección: ${entry.description}`,
                        }));
                        setShowDraftForm(true);
                      }}
                    >
                      Crear corrección
                    </Button>
                  ) : (
                    <span className="muted-copy">Sin acciones</span>
                  ),
              },
            ]}
          />
        )}
        {submitDraft.isError ? (
          <p className="form-error" role="alert">
            {submitDraft.error.message}
          </p>
        ) : null}
      </section>

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
              action={
                !search && canCreateDraft ? (
                  <Button size="sm" variant="secondary" onClick={() => setShowDraftForm(true)}>
                    Crear asiento
                  </Button>
                ) : undefined
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
                    <Button
                      type="button"
                      variant="text"
                      size="row"
                      className="ledger-entry-action"
                      aria-expanded={expandedId === entry.id}
                      onClick={() =>
                        setExpandedId((current) => (current === entry.id ? null : entry.id))
                      }
                    >
                      #{entry.sequenceNumber ?? "—"}
                      <Icon name="chevron" size={13} />
                    </Button>
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
              action={
                canCreateDraft ? (
                  <Button size="sm" variant="secondary" onClick={() => setShowDraftForm(true)}>
                    Crear asiento
                  </Button>
                ) : undefined
              }
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
              action={
                canCreateDraft ? (
                  <Button size="sm" variant="secondary" onClick={() => setShowDraftForm(true)}>
                    Crear asiento
                  </Button>
                ) : undefined
              }
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
    
    </DensePage>
  );
}
