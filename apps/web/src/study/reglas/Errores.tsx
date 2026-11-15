import { Button, Notice } from "@contable/design-system";

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
