import { useRef, type InputHTMLAttributes } from "react";

interface CampoArchivoProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value"> {
  label: string;
  id: string;
  hint?: string;
  /** Archivo elegido, para leer su nombre en lugar del texto del navegador (en inglés). */
  archivo?: File | null;
}

/** Control de archivo con el texto en español: botón «Elegir archivo» y el nombre elegido. */
export function CampoArchivo({ label, id, hint, archivo, ...rest }: CampoArchivoProps) {
  const entrada = useRef<HTMLInputElement>(null);
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="ds-field">
      <label className="ds-field__label" htmlFor={id}>{label}</label>
      <div className="campo-archivo">
        <input ref={entrada} id={id} type="file" className="campo-archivo__input" aria-describedby={hintId} {...rest} />
        <button type="button" tabIndex={-1} aria-hidden="true" className="campo-archivo__boton" onClick={() => entrada.current?.click()}>Elegir archivo</button>
        <span className="campo-archivo__nombre">{archivo ? archivo.name : "Ningún archivo elegido"}</span>
      </div>
      {hint ? <span className="ds-field__hint" id={hintId}>{hint}</span> : null}
    </div>
  );
}
