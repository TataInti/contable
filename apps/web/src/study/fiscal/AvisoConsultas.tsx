import { Button, Notice } from "@contable/design-system";

type ConsultaFallida = { key: string; label: string; query: { isError: boolean; refetch: () => unknown } };

export function AvisoConsultas({ failedQueries }: { failedQueries: ConsultaFallida[] }) {
  return (
    <Notice tone="error">
      <p>
        <strong>
          No pudimos cargar {failedQueries.length === 1 ? failedQueries[0]?.label ?? "la información" : "parte de la información"}.
        </strong>{" "}
        Revisá tu conexión e intentá de nuevo.
      </p>
      {failedQueries.map((item) =>
        item.query.isError ? (
          <Button
            key={item.key}
            type="button"
            variant="text"
            size="row"
            onClick={() => item.query.refetch()}
          >
            Reintentar {item.label}
          </Button>
        ) : null,
      )}
    </Notice>
  );
}
