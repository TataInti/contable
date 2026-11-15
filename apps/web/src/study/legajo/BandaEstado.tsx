import { StatStrip } from "../../ui/Dense";

interface BandaEstadoProps {
  legajos: number | string;
  componentes: number | string;
}

/** Banda «Estado del legajo»: cifras con alcance; sin «Etapa actual» (es navegación) y con «pendiente» mientras carga (D10, C03). */
export function BandaEstado({ legajos, componentes }: BandaEstadoProps) {
  return (
    <StatStrip
      label="Estado del legajo"
      items={[
        { key: "workpapers", label: legajos === 1 ? "Legajo" : "Legajos", value: legajos },
        {
          key: "components",
          label: componentes === 1 ? "Componente" : "Componentes",
          value: componentes,
        },
      ]}
    />
  );
}
