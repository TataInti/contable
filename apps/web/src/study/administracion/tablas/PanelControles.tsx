type Props = {
  selfReviewSetting: { data?: { allowSelfReview: boolean }; isLoading: boolean; isError: boolean; error: unknown };
  updateSelfReviewSetting: { isPending: boolean; isError: boolean; error: unknown; mutate: (allowSelfReview: boolean) => void };
  canManageSelfReview: boolean;
};

export function PanelControles({ selfReviewSetting, updateSelfReviewSetting, canManageSelfReview }: Props) {
  return (
    <section className="study-panel self-review-setting" aria-labelledby="self-review-setting-title">
      <div className="self-review-setting__heading">
        <h2 className="self-review-setting__title" id="self-review-setting-title">
          Permitir autorrevisión de fuentes y legajos
        </h2>
        <p>
          Permite que el Titular y los Administradores revisen los lotes que importaron y
          revisen y finalicen los legajos que prepararon. Los demás roles siempre necesitan
          a otra persona. La opción reduce el control interno de cuatro ojos; cada
          autorrevisión queda registrada en la auditoría.
        </p>
      </div>
      <label className="self-review-setting__toggle">
        <input
          type="checkbox"
          aria-label="Permitir autorrevisión de fuentes y legajos"
          checked={selfReviewSetting.data?.allowSelfReview ?? false}
          disabled={
            !canManageSelfReview ||
            selfReviewSetting.isLoading ||
            selfReviewSetting.isError ||
            updateSelfReviewSetting.isPending
          }
          onChange={(event) => updateSelfReviewSetting.mutate(event.target.checked)}
        />
        <span>{selfReviewSetting.data?.allowSelfReview ? "Activada" : "Desactivada"}</span>
      </label>
      {!canManageSelfReview ? (
        <small className="muted-copy">Solo el Titular puede cambiar esta opción.</small>
      ) : null}
      {selfReviewSetting.isError ? (
        <p className="form-error" role="alert">
          {selfReviewSetting.error instanceof Error
            ? selfReviewSetting.error.message
            : "No se pudo consultar la configuración de autorrevisión."}
        </p>
      ) : null}
      {updateSelfReviewSetting.isError ? (
        <p className="form-error" role="alert">
          {updateSelfReviewSetting.error instanceof Error
            ? updateSelfReviewSetting.error.message
            : "No se pudo actualizar la configuración de autorrevisión."}
        </p>
      ) : null}
    </section>
  );
}
