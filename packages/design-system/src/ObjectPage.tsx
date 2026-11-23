import type { ReactNode } from "react";
import "./ObjectPage.css";

export interface BreadcrumbItem {
  label: string;
  /** Ruta del nivel superior. El último elemento va sin enlace: es la página actual. */
  href?: string;
}

export interface BreadcrumbProps {
  items: readonly BreadcrumbItem[];
  /** Nombre accesible de la navegación. */
  label?: string;
}

/** Migas de pan: la ubicación del objeto dentro de la cartera, por ejemplo «Clientes › Cliente A». */
export function Breadcrumb({ items, label = "Ubicación" }: BreadcrumbProps) {
  return (
    <nav className="breadcrumb" aria-label={label}>
      <ol className="breadcrumb__lista">
        {items.map((item, indice) => {
          const actual = indice === items.length - 1;
          return (
            <li key={`${item.label}-${indice}`} className="breadcrumb__item">
              {actual || !item.href ? (
                <span className="breadcrumb__actual" aria-current={actual ? "page" : undefined}>
                  {item.label}
                </span>
              ) : (
                <a className="breadcrumb__enlace" href={item.href}>
                  {item.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface ObjectPageProps {
  breadcrumb: readonly BreadcrumbItem[];
  /** Nombre del objeto de larga vida, por ejemplo el cliente. */
  title: string;
  /** Estado del objeto (un `StatusBadge` o texto). */
  status?: ReactNode;
  description?: string;
  /** Acciones de la cabecera: como máximo una primaria. Configuración fiscal va aquí como enlace. */
  actions?: ReactNode;
  /** Secciones de la página: períodos, actividad, etc. */
  children: ReactNode;
}

/**
 * Página de un objeto de larga vida (cliente): ubicación, cabecera con su estado y acciones, y las
 * secciones de su contenido. El detalle de cada período vive en su propia página.
 */
export function ObjectPage({
  breadcrumb,
  title,
  status,
  description,
  actions,
  children,
}: ObjectPageProps) {
  return (
    <article className="object-page">
      <Breadcrumb items={breadcrumb} />
      <header className="object-page__cabecera">
        <div className="object-page__identidad">
          <h1 className="object-page__titulo">{title}</h1>
          {status ? <div className="object-page__estado">{status}</div> : null}
          {description ? <p className="object-page__descripcion">{description}</p> : null}
        </div>
        {actions ? <div className="object-page__acciones">{actions}</div> : null}
      </header>
      <div className="object-page__cuerpo">{children}</div>
    </article>
  );
}
