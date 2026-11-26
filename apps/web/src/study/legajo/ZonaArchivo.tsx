import { useState } from "react";

/** Zona de archivo única del Legajo: arrastrar o «Elegir archivo» (la misma de la Bandeja). */
export function ZonaArchivo({
  archivo,
  onArchivo,
  accept,
  titulo = "Arrastrá un archivo o elegilo desde tu equipo",
  ayuda,
  id,
}: {
  archivo: File | null;
  onArchivo: (file: File | null) => void;
  accept: string;
  titulo?: string;
  ayuda?: string;
  id?: string;
}) {
  const [arrastrando, setArrastrando] = useState(false);
  return (
    <label
      className={`upload-dropzone${arrastrando ? " upload-dropzone--dragging" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setArrastrando(true); }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={(event) => { event.preventDefault(); setArrastrando(false); onArchivo(event.dataTransfer.files[0] ?? null); }}
    >
      <input id={id} type="file" aria-label="Elegir archivo" accept={accept} onChange={(event) => onArchivo(event.target.files?.[0] ?? null)} />
      <span>
        <strong>{archivo ? archivo.name : titulo}</strong>
        {ayuda ? <small>{ayuda}</small> : null}
      </span>
      <span className="upload-dropzone__action" aria-hidden="true">Elegir archivo</span>
    </label>
  );
}
