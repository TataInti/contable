/** Candado de una etapa que todavía no se puede abrir: el motivo va en el tooltip. */
export function Candado({ motivo }: { motivo: string | null }) {
  const texto = motivo ? `No disponible todavía: ${motivo}` : "No disponible todavía";
  return (
    <span className="workpaper-candado" title={texto}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
      <span className="sr-only">{texto}</span>
    </span>
  );
}
