import { Button, Notice } from "@contable/design-system";
import { FieldErrorsFromDetails } from "../../components/forms/FieldErrorsFromDetails";
import { ApiError } from "../../lib/api";

// Error de una consulta (catálogo o lista): va junto al dato afectado, con su Reintentar,
// y deja disponible el resto de la pantalla (C07, C08).
export function ErrorConsulta({
  titulo,
  descripcion,
  onRetry,
}: {
  titulo: string;
  descripcion: string;
  onRetry: () => void;
}) {
  return (
    <Notice
      tone="error"
      title={titulo}
      action={
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      }
    >
      {descripcion}
    </Notice>
  );
}

// Error de una acción (guardar, activar, aprobar…): va junto a su botón o dentro de su cajón,
// nunca al pie de la pantalla (D-R3-3).
export function ErrorAccion({ error }: { error: Error }) {
  return error instanceof ApiError ? (
    <FieldErrorsFromDetails error={error} />
  ) : (
    <Notice tone="error">{error.message}</Notice>
  );
}
