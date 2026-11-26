import type { InputHTMLAttributes } from "react";

interface CampoArchivoProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value"> {
  label: string;
  id: string;
  hint?: string;
  /** Archivo elegido, para leer su nombre en lugar del texto del navegador (en inglés). */
  archivo?: File | null;
}

/** Control de archivo con el texto en español: botón «Elegir archivo» y el nombre elegido. */
export function CampoArchivo({ label, id, hint, archivo, ...rest }: CampoArchivoProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="ds-field">
      <label className="ds-field__label" htmlFor={id}>{label}</label>
      <div className="campo-archivo">
        <input id={id} type="file" className="campo-archivo__input" aria-describedby={hintId} {...rest} />
        <label htmlFor={id} className="campo-archivo__boton" aria-hidden="true">Elegir archivo</label>
        <span className="campo-archivo__nombre">{archivo ? archivo.name : "Ningún archivo elegido"}</span>
      </div>
      {hint ? <span className="ds-field__hint" id={hintId}>{hint}</span> : null}
    </div>
  );
}
