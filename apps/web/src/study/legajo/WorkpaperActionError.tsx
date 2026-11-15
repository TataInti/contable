import { useEffect, useRef } from "react";
import { ApiError } from "../../lib/api";
import { FieldErrorsFromDetails } from "../../components/forms/FieldErrorsFromDetails";

export function WorkpaperActionError({ error }: { error: Error | null | undefined }) {
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!error || !errorRef.current) return;
    errorRef.current.focus({ preventScroll: true });
    errorRef.current.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [error]);

  if (!error) return null;

  return (
    <div className="workpaper-action-error" ref={errorRef} tabIndex={-1}>
      {error instanceof ApiError ? (
        <FieldErrorsFromDetails error={error} />
      ) : (
        <p className="form-error" role="alert">
          {error.message || "No se pudo completar la acción."}
        </p>
      )}
    </div>
  );
}
