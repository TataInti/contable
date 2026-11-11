// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkpaperSourceReviewAction } from "./WorkpaperSourceReviewAction";

const pendingBatch = {
  id: "source-link-1",
  batchStatus: "COMMITTED",
  reviewStatus: "PENDING_REVIEW",
  createdByUserId: "user-importer",
  reviewedByUserId: null,
  reviewedAt: null,
};

afterEach(() => cleanup());

describe("WorkpaperSourceReviewAction", () => {
  it("mantiene visible Revisar y explica cómo habilitar la autorrevisión", () => {
    render(
      <WorkpaperSourceReviewAction
        batch={pendingBatch}
        currentUserId="user-importer"
        allowSelfReview={false}
        canEditSources
        canReview
        pending={false}
        error={null}
        onReview={vi.fn()}
      />,
    );

    expect((screen.getByRole("button", { name: "Revisar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText(/Titular puede habilitar la autorrevisión en Configuración del estudio/),
    ).toBeTruthy();
  });

  it("permite la acción con la opción activa y muestra su error junto al botón", () => {
    const onReview = vi.fn();
    const error = new Error("La fuente no se pudo revisar");
    render(
      <WorkpaperSourceReviewAction
        batch={pendingBatch}
        currentUserId="user-importer"
        allowSelfReview
        canEditSources
        canReview
        pending={false}
        error={error}
        onReview={onReview}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect(onReview).toHaveBeenCalledWith("source-link-1");
    expect(screen.getByRole("alert").textContent).toBe("La fuente no se pudo revisar");
  });

  it("identifica a la misma persona al mostrar una fuente ya revisada", () => {
    render(
      <WorkpaperSourceReviewAction
        batch={{ ...pendingBatch, reviewStatus: "REVIEWED", reviewedByUserId: "user-importer" }}
        currentUserId="user-importer"
        allowSelfReview={false}
        canEditSources
        canReview
        pending={false}
        error={null}
        onReview={vi.fn()}
      />,
    );

    expect(screen.getByText("Revisado por la misma persona que importó.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revisar" })).toBeNull();
  });
});