import { Button } from "./Button.js";
import { EmptyState } from "./EmptyState.js";

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
      <EmptyState
        className={`async-state async-state--error ${className}`}
        role="alert"
        title={errorTitle}
        description={errorDescription}
        action={
          <Button type="button" variant="secondary" onClick={onRetry}>
            Reintentar
          </Button>
        }
      />
    );
  }

  return null;
}
