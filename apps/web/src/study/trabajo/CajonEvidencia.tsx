import type { Dispatch, SetStateAction } from "react";
import { ActionDrawer } from "../../ui/ActionDrawer";
import type { EvidencePreview } from "./tipos";

interface CajonEvidenciaProps {
  preview: EvidencePreview | null;
  setPreview: Dispatch<SetStateAction<EvidencePreview | null>>;
}

export function CajonEvidencia({ preview, setPreview }: CajonEvidenciaProps) {
  return (
    <>
      <ActionDrawer
        isOpen={Boolean(preview)}
        onClose={() => setPreview(null)}
        title="Documento adjunto"
        description={preview?.originalName ?? "Vista previa de la evidencia asociada al pedido."}
        size="wide"
      >
        {preview ? (
          <div className="evidence-preview">
            {preview.mimeType === "application/pdf" ? (
              <iframe
                src={preview.url}
                title="Vista previa del documento"
                className="evidence-preview__frame"
              />
            ) : (
              <img
                src={preview.url}
                alt="Vista previa del documento"
                className="evidence-preview__image"
              />
            )}
            <a
              className="evidence-preview__link"
              href={preview.url}
              target="_blank"
              rel="noreferrer"
            >
              Abrir en pestaña nueva
            </a>
          </div>
        ) : null}
      </ActionDrawer>
    </>
  );
}
