export interface SectionIndexItem {
  id: string;
  label: string;
  meta?: string;
}

interface SectionIndexProps {
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
          <a key={item.id} href={`#${item.id}`}>
            <span>{item.label}</span>
            {item.meta ? <small>{item.meta}</small> : null}
          </a>
        ))}
      </div>
    </nav>
  );
}
