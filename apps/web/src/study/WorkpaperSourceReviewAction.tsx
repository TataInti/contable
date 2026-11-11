import { Button } from "@contable/design-system";

export interface WorkpaperSourceReviewBatch {
  id: string;
  batchStatus: string;
  reviewStatus: string;
  createdByUserId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
}

interface WorkpaperSourceReviewActionProps {
  batch: WorkpaperSourceReviewBatch;
  currentUserId: string | null;
  allowSelfReview: boolean;
  canEditSources: boolean;
  canReview: boolean;
  pending: boolean;
  error: Error | null;
  onReview: (sourceLinkId: string) => void;
}

export function WorkpaperSourceReviewAction({
  batch,
  currentUserId,
  allowSelfReview,
  canEditSources,
  canReview,
  pending,
  error,
  onReview,
}: WorkpaperSourceReviewActionProps) {
  const isImportedByCurrentUser = Boolean(
    currentUserId && batch.createdByUserId && batch.createdByUserId === currentUserId,
  );
  const selfReviewBlocked = isImportedByCurrentUser && !allowSelfReview;
  const wasSelfReviewed = Boolean(
    batch.createdByUserId &&
      batch.reviewedByUserId &&
      batch.createdByUserId === batch.reviewedByUserId,
  );
  const reviewedAtLabel = batch.reviewedAt
    ? new Intl.DateTimeFormat("es-AR", {
        timeZone: "UTC",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(batch.reviewedAt))
    : null;
  const showReviewButton =
    batch.batchStatus === "COMMITTED" &&
    batch.reviewStatus !== "REVIEWED" &&
    canEditSources &&
    canReview;

  return (
    <div className="workpaper-source-review">
      {showReviewButton ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending || selfReviewBlocked}
          title={
            selfReviewBlocked
              ? "El Titular puede habilitar la autorrevisión en Configuración del estudio."
              : undefined
          }
          onClick={() => onReview(batch.id)}
        >
          Revisar
        </Button>
      ) : null}
      {showReviewButton && selfReviewBlocked ? (
        <small className="muted-copy">
          Para revisar este lote, el Titular puede habilitar la autorrevisión en Configuración del estudio.
        </small>
      ) : null}
      {error ? (
        <small className="form-error" role="alert">
          {error.message}
        </small>
      ) : null}
      {wasSelfReviewed ? (
        <small className="muted-copy" role="status">
          Revisado por la misma persona que importó
          {reviewedAtLabel ? ` · ${reviewedAtLabel}` : ""}.
        </small>
      ) : null}
    </div>
  );
}