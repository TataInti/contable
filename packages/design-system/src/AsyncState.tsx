import { Button } from "./Button.js";
import { Notice } from "./Notice.js";

export interface AsyncStateProps {
  loading: boolean;
  error: boolean;
  loadingLabel: string;
  errorTitle: string;
  errorDescription: string;
  onRetry: () => void;
  className?: string;
}

export function AsyncState({
  loading,
  error,
  loadingLabel,
  errorTitle,
  errorDescription,
  onRetry,
  className = "",
}: AsyncStateProps) {
  if (loading) {
    return (
      <div className={`async-state async-state--loading ${className}`} role="status" aria-live="polite">
        <span className="loading-copy">{loadingLabel}</span>
      </div>
    );
  }

  if (error) {
    return (
      <Notice
        tone="error"
        className={`async-state async-state--error ${className}`}
        title={errorTitle}
        action={
          <Button type="button" variant="secondary" onClick={onRetry}>
            Reintentar
          </Button>
        }
      >
        {errorDescription}
      </Notice>
    );
  }

  return null;
}
