import { Button, SearchSelect } from "@contable/design-system";
import type { SummarySectionDefinition, SummarySectionId } from "./busqueda";

type Props = {
  secciones: SummarySectionDefinition[];
  activeSection: SummarySectionId;
  hayBusqueda: boolean;
  onSelect: (id: SummarySectionId) => void;
};

export function IndiceSecciones({ secciones, activeSection, hayBusqueda, onSelect }: Props) {
  const sectionGroups: SummarySectionDefinition["group"][] = [
    "Datos generales",
    "Contable",
    "Fiscal",
    "Configuración fiscal",
    "Configuración",
  ];
  return (
    <>
      <label className="client-summary__index-select-control">
        <span className="sr-only">Sección del cliente</span>
        <SearchSelect
          label="Sección del cliente"
          hideLabel
          className="client-summary__index-select"
          value={activeSection}
          onChange={(value) => {
            onSelect(value as SummarySectionId);
          }}
          allowEmpty={false}
          options={secciones.map((section) => ({
            value: section.id,
            label: section.group === section.label ? section.label : `${section.group} · ${section.label}`,
          }))}
        />
      </label>
      <nav className="client-summary__section-index" aria-label="Secciones internas del cliente">
        {sectionGroups.map((group) => {
          const groupSections = secciones.filter((section) => section.group === group);
          if (groupSections.length === 0) return null;
          // El grupo que se llama igual que su única sección no repite el nombre como encabezado.
          const repiteNombre = groupSections.length === 1 && groupSections[0]?.label === group;
          return (
            <div className="client-summary__index-group" key={group}>
              {repiteNombre ? null : <p>{group}</p>}
              <ul>
                {groupSections.map((section) => (
                  <li key={section.id}>
                    <Button
                      type="button"
                      variant="text"
                      size="row"
                      className="client-summary__index-link"
                      aria-current={activeSection === section.id && !hayBusqueda ? "page" : undefined}
                      onClick={() => {
                        onSelect(section.id);
                      }}
                    >
                      <span>{section.label}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </>
  );
}
