import { StatStrip } from "../../ui/Dense";

interface BandaEstadoProps {
  legajos: number | string;
  etapa: string;
  componentes: number | string;
}

/** Banda «Estado del legajo»: cifras del período con su alcance (C03). */
export function BandaEstado({ legajos, etapa, componentes }: BandaEstadoProps) {
  return (
    <StatStrip
      label="Estado del legajo"
      items={[
        { key: "workpapers", label: "Legajos", value: legajos },
        { key: "step", label: "Etapa actual", value: etapa },
        { key: "components", label: "Componentes", value: componentes },
      ]}
    />
  );
}
