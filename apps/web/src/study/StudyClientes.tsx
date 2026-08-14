import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import { api, type Client } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import "./study.css";

function formatCuit(cuit: string) {
  return cuit.length === 11 ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}` : cuit;
}

export function StudyClientes() {
  const { firmId, clientId, capabilities, setClientId } = useClientContext();
  const session = useSession();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ legalName: "", tradeName: "", cuit: "" });
  const query = useQuery({
    queryKey: ["clients", firmId],
    queryFn: () => api.get<Client[]>(`/firms/${firmId}/clients`),
    enabled: Boolean(firmId),
  });
  const create = useMutation({
    mutationFn: () =>
      api.post<Client>(`/firms/${firmId}/clients`, {
        legalName: form.legalName.trim(),
        cuit: form.cuit,
        ...(form.tradeName.trim() ? { tradeName: form.tradeName.trim() } : {}),
      }),
    onSuccess: async (client) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["clients", firmId] }),
        session.refresh(),
      ]);
      setClientId(client.id);
      setCreating(false);
      setForm({ legalName: "", tradeName: "", cuit: "" });
    },
  });
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es-AR");
    if (!needle) return query.data ?? [];
    return (query.data ?? []).filter(
      (client) =>
        client.legalName.toLocaleLowerCase("es-AR").includes(needle) ||
        client.cuit.includes(needle.replace(/\D/g, "")),
    );
  }, [query.data, search]);

  return (
    <div className="study-page">
      <div className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Cartera del estudio</p>
          <h1 className="study-page__title">Clientes</h1>
          <p className="study-page__subtitle">
            Elegí el contexto de trabajo o incorporá una nueva empresa.
          </p>
        </div>
        {capabilities.has("client.manage") ? (
          <Button
            onClick={() => setCreating((value) => !value)}
            variant={creating ? "secondary" : "primary"}
          >
            <Icon name={creating ? "close" : "plus"} size={17} />
            {creating ? "Cancelar" : "Nuevo cliente"}
          </Button>
        ) : null}
      </div>

      {creating ? (
        <section className="study-panel study-panel--form" aria-labelledby="new-client-title">
          <div className="study-panel__heading">
            <div>
              <h2 id="new-client-title">Alta de cliente</h2>
              <p>Completá los datos fiscales básicos. Podrás configurar el resto después.</p>
            </div>
          </div>
          <form
            className="study-inline-form study-inline-form--client"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <Field
              id="client-legal-name"
              label="Razón social"
              value={form.legalName}
              onChange={(event) => setForm({ ...form, legalName: event.target.value })}
              maxLength={200}
              required
            />
            <Field
              id="client-trade-name"
              label="Nombre comercial"
              value={form.tradeName}
              onChange={(event) => setForm({ ...form, tradeName: event.target.value })}
              maxLength={100}
            />
            <Field
              id="client-cuit"
              label="CUIT"
              value={form.cuit}
              onChange={(event) =>
                setForm({ ...form, cuit: event.target.value.replace(/\D/g, "").slice(0, 11) })
              }
              inputMode="numeric"
              pattern="[0-9]{11}"
              hint="11 dígitos, sin guiones"
              required
            />
            {create.isError ? (
              <p className="form-error study-inline-form__feedback" role="alert">
                No se pudo crear el cliente. Revisá el CUIT y los permisos.
              </p>
            ) : null}
            <div className="study-inline-form__actions">
              <Button
                type="submit"
                loading={create.isPending}
                loadingLabel="Creando cliente"
                disabled={form.legalName.trim().length < 2 || form.cuit.length !== 11}
              >
                Crear cliente
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="study-page__section" aria-labelledby="client-list-title">
        <div className="collection-toolbar">
          <div>
            <h2 id="client-list-title">Cartera</h2>
            <p>
              {query.isLoading
                ? "Consultando clientes…"
                : `${rows.length} ${rows.length === 1 ? "cliente" : "clientes"}`}
            </p>
          </div>
          <label className="collection-search">
            <span className="sr-only">Buscar clientes</span>
            <Icon name="search" size={17} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre o CUIT"
            />
          </label>
        </div>
        {query.isLoading ? (
          <div className="query-state" role="status">
            <span className="loading-copy">Cargando la cartera…</span>
          </div>
        ) : query.isError ? (
          <EmptyState
            title="No se pudieron cargar los clientes"
            description="Reintentá en unos minutos o comprobá tu conexión."
            action={
              <Button variant="secondary" onClick={() => void query.refetch()}>
                Reintentar
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={search ? "No encontramos coincidencias" : "Todavía no hay clientes"}
            description={
              search
                ? "Probá con otro nombre o CUIT."
                : "Creá el primer cliente para comenzar a organizar la operación."
            }
            action={
              !search && capabilities.has("client.manage") ? (
                <Button onClick={() => setCreating(true)}>Crear cliente</Button>
              ) : undefined
            }
          />
        ) : (
          <Table
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "legalName",
                header: "Cliente",
                render: (row) => (
                  <button
                    className="client-link"
                    aria-current={clientId === row.id ? "true" : undefined}
                    onClick={() => setClientId(row.id)}
                  >
                    <span className="client-link__avatar" aria-hidden="true">
                      {row.legalName.slice(0, 1).toLocaleUpperCase("es-AR")}
                    </span>
                    <span>
                      <strong>{row.legalName}</strong>
                      <small>{clientId === row.id ? "Contexto activo" : "Abrir contexto"}</small>
                    </span>
                  </button>
                ),
              },
              {
                key: "cuit",
                header: "CUIT",
                render: (row) => <span className="tabular-copy">{formatCuit(row.cuit)}</span>,
              },
              {
                key: "status",
                header: "Estado",
                render: (row) => <StatusBadge status={row.status} />,
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (row) => (
                  <button
                    className="row-arrow"
                    aria-label={`Trabajar con ${row.legalName}`}
                    onClick={() => setClientId(row.id)}
                  >
                    <Icon name="arrow-right" size={17} />
                  </button>
                ),
              },
            ]}
          />
        )}
      </section>
    </div>
  );
}
