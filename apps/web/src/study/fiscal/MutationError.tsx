import { Notice } from "@contable/design-system";

export function MutationError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Ocurrió un error inesperado.";
  return <Notice tone="error">{message}</Notice>;
}
