// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListaPaquetes } from "./ListaPaquetes";
import type { RulePack } from "./tipos";

function paquete(i: number): RulePack {
  return {
    id: `pack-${i}`,
    code: `COD-${i}`,
    name: `Paquete ${i}`,
    status: "ACTIVE",
    origin: "UI",
    versions: [],
    regime: {
      id: `regimen-${i}`,
      name: "Régimen",
      isActive: true,
      taxType: { name: "IVA", isActive: true },
      jurisdiction: { name: "Nación", isActive: true },
    },
  } as unknown as RulePack;
}

function renderLista(cantidad: number, selectedPackId: string | null) {
  const packs = Array.from({ length: cantidad }, (_, i) => paquete(i + 1));
  return render(
    <ListaPaquetes
      packs={packs}
      isLoading={false}
      isEmpty={false}
      isError={false}
      onRetry={() => undefined}
      search=""
      onSearchChange={() => undefined}
      searchRef={createRef<HTMLInputElement>()}
      filter=""
      onClearFilter={() => undefined}
      selectedPackId={selectedPackId}
      onSelectPack={() => undefined}
      canPropose={false}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Lista de paquetes con 7 paquetes (Foco 2.7a)", () => {
  it("sin alturas medidas cuenta los 7 y el pie ofrece la elección solo si no hay paquete elegido", async () => {
    renderLista(7, null);
    expect(await screen.findByText("7 paquetes")).toBeTruthy();
    expect(screen.getByText("Elegí un paquete para ver sus versiones y reglas.")).toBeTruthy();
    cleanup();
    renderLista(7, "pack-2");
    expect(await screen.findByText("7 paquetes")).toBeTruthy();
    expect(screen.queryByText("Elegí un paquete para ver sus versiones y reglas.")).toBeNull();
  });

  it("con la séptima fila cortada, el pie dice «6 de 7 paquetes»", async () => {
    // jsdom no calcula el diseño: cabecera de 34 px, filas de 40 px y un contenedor de 274 px.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const caja = (top: number, bottom: number) =>
        ({
          top,
          bottom,
          left: 0,
          right: 0,
          height: bottom - top,
          width: 0,
          x: 0,
          y: top,
          toJSON: () => ({}),
        }) as DOMRect;
      if (this.classList.contains("dense-table-scroll")) return caja(0, 274);
      if (this.tagName === "THEAD") return caja(0, 34);
      if (this.tagName === "TR") {
        const indice = Array.from(this.parentElement!.children).indexOf(this);
        return caja(34 + indice * 40, 74 + indice * 40);
      }
      return caja(0, 0);
    });
    renderLista(7, null);
    expect(await screen.findByText("6 de 7 paquetes")).toBeTruthy();
  });
});
