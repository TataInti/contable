import { Button } from "./Button.js";

export interface SectionIndexItem {
  id: string;
  label: string;
  meta?: string;
}

export interface SectionIndexProps {
  items: SectionIndexItem[];
  label?: string;
}

/** Índice liviano para navegar vistas con varias áreas relacionadas. */
export function SectionIndex({
  items,
  label = "Secciones de esta vista",
}: SectionIndexProps) {
  return (
    <nav className="section-index" aria-label={label}>
      <span className="section-index__label">Índice</span>
      <div className="section-index__links">
        {items.map((item) => (
          <Button key={item.id} href={`#${item.id}`} variant="link" size="row">
            <span>{item.label}</span>
            {item.meta ? <small>{item.meta}</small> : null}
          </Button>
        ))}
      </div>
    </nav>
  );
}
