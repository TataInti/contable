// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./Button.js";
import { Breadcrumb, ObjectPage } from "./ObjectPage.js";
import { StatusBadge } from "./StatusBadge.js";

describe("Breadcrumb", () => {
  afterEach(() => cleanup());

  it("es una navegación con nombre; el último nivel es la página actual, sin enlace", () => {
    render(
      <Breadcrumb
        items={[{ label: "Clientes", href: "/clientes" }, { label: "Cliente sintético A" }]}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Ubicación" });
    expect(within(nav).getByRole("link", { name: "Clientes" })).toHaveAttribute(
      "href",
      "/clientes",
    );
    const actual = within(nav).getByText("Cliente sintético A");
    expect(actual).toHaveAttribute("aria-current", "page");
    expect(within(nav).queryAllByRole("link")).toHaveLength(1);
  });
});

describe("ObjectPage", () => {
  afterEach(() => cleanup());

  it("muestra ubicación, título único (h1), estado, acciones y secciones", () => {
    render(
      <ObjectPage
        breadcrumb={[{ label: "Clientes", href: "/clientes" }, { label: "Cliente sintético A" }]}
        title="Cliente sintético A"
        status={<StatusBadge status="CONFIGURED" variant="pill" />}
        description="CUIT sintético 20-00000000-1"
        actions={
          <>
            <Button type="button" variant="primary">
              Abrir legajo
            </Button>
            <Button type="button" variant="secondary" href="/clientes/1/configuracion-fiscal">
              Configuración fiscal
            </Button>
          </>
        }
      >
        <section aria-label="Períodos">
          <p>Períodos sintéticos</p>
        </section>
      </ObjectPage>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Cliente sintético A" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Ubicación" })).toBeInTheDocument();
    expect(screen.getByText("Configurada").parentElement?.parentElement?.parentElement).toBe(
      screen.getByRole("heading", { level: 1, name: "Cliente sintético A" }).parentElement,
    );
    expect(screen.getByRole("link", { name: "Configuración fiscal" })).toHaveAttribute(
      "href",
      "/clientes/1/configuracion-fiscal",
    );
    expect(screen.getByRole("region", { name: "Períodos" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("sin acciones ni estado no dibuja esos bloques", () => {
    const { container } = render(
      <ObjectPage breadcrumb={[{ label: "Clientes" }]} title="Cliente">
        <p>Contenido</p>
      </ObjectPage>,
    );

    expect(container.querySelector(".object-page__acciones")).toBeNull();
    expect(container.querySelector(".object-page__estado")).toBeNull();
  });

  it("no tiene un <select> nativo", () => {
    render(
      <ObjectPage breadcrumb={[{ label: "Clientes" }]} title="Cliente">
        <p>Contenido</p>
      </ObjectPage>,
    );
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });
});
