import { Button } from "@contable/design-system";

interface Faltante {
  key: string;
  label: string;
  step: string;
}

interface ListaFaltantesProps<T extends Faltante> {
  faltantes: readonly T[];
  onAbrir: (faltante: T) => void;
}

/** «Falta: a, b, c.» con cada dato como enlace y las comas pegadas a la palabra anterior. */
export function ListaFaltantes<T extends Faltante>({ faltantes, onAbrir }: ListaFaltantesProps<T>) {
  return (
    <span className="faltantes-lista">
      Falta:{" "}
      {faltantes.map((faltante, index) => (
        <span key={faltante.key}>
          {index ? ", " : ""}
          <Button type="button" variant="text" size="row" onClick={() => onAbrir(faltante)}>
            {faltante.label}
          </Button>
        </span>
      ))}
      .
    </span>
  );
}
