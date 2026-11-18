import { useLayoutEffect, useRef, type ReactNode } from "react";
import "./WorkPage.css";

export interface WorkPageProps {
  /** La barra de trabajo (WorkBar). Ocupa su lugar arriba, fuera del área que se desplaza. */
  bar: ReactNode;
  /** Contenido del cuerpo: es lo único que se desplaza, empezando justo bajo la barra. */
  children: ReactNode;
  className?: string;
}

/**
 * Página de trabajo (P5). Ubica la barra fuera del área que se desplaza: el cuerpo es el único
 * contenedor de desplazamiento y empieza justo bajo la barra. Va como hijo directo de
 * `main.study__content`; la regla `.study__content:has(> .work-page)` quita allí el desplazamiento
 * y el relleno, sin tocar la pantalla de estudio.
 */
export function WorkPage({ bar, children, className }: WorkPageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const body = bodyRef.current;
    if (!root || !body) return;
    // La barra suma la barra de desplazamiento del cuerpo, así sus bordes coinciden con los del
    // contenido. El ancho se mide, no se fija: depende del sistema operativo.
    const medir = () => {
      root.style.setProperty("--work-page-scrollbar", `${body.offsetWidth - body.clientWidth}px`);
    };
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(medir);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} className={className ? `work-page ${className}` : "work-page"}>
      {bar}
      <div ref={bodyRef} className="work-page__body">
        <div className="work-page__content">{children}</div>
      </div>
    </div>
  );
}
