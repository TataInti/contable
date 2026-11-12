// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DenseFooter,
  DenseHeader,
  DenseLoading,
  DensePage,
  DenseSection,
  DenseTable,
  DenseToolbar,
  DenseWorkspace,
  DensitySwitch,
  Inspector,
  InspectorFacts,
  InspectorSection,
  normalizeSearch,
  StatStrip,
  useDenseShortcuts,
  useDensity,
  type DenseColumn,
} from "./Dense.js";

afterEach(() => cleanup());

beforeEach(() => window.localStorage.clear());

describe("familia Dense", () => {
  it("compone página, encabezado, sección, barra y espacio de trabajo", () => {
    render(
      <DensePage density={32} flow className="client-page">
        <DenseHeader eyebrow="Clientes" title="Cartera" description="Clientes del estudio" />
        <DenseSection id="summary" title="Resumen" count={2} description="Estado general">
          <DenseToolbar>Filtros</DenseToolbar>
          <DenseWorkspace panelId="clientes-panel">
            <p>Contenido de clientes</p>
          </DenseWorkspace>
        </DenseSection>
      </DensePage>,
    );

    const page = document.querySelector<HTMLElement>(".dense-page");
    expect(page).toHaveClass("dense-page--flow", "client-page");
    expect(page?.style.getPropertyValue("--dense-row-h")).toBe("32px");
    expect(screen.getByRole("heading", { level: 1, name: "Cartera" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Resumen2" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "clientes-panel");
    expect(screen.getByText("Filtros").closest(".dense-toolbar")).toBeInTheDocument();
  });

  it("expone la selección y los estados de métricas y densidad", () => {
    const onSelect = vi.fn();
    const onChange = vi.fn();
    render(
      <>
        <StatStrip
          label="Resumen"
          items={[
            {
              key: "pending",
              label: "Pendientes",
              value: 3,
              detail: "para revisar",
              tone: "warn",
              active: true,
              onSelect,
            },
          ]}
        />
        <DensitySwitch value={32} onChange={onChange} />
      </>,
    );

    const pending = screen.getByRole("button", { name: /Pendientes/ });
    expect(pending).toHaveClass("dense-stat", "dense-stat--warn", "dense-stat--active");
    fireEvent.click(pending);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(within(screen.getByRole("group", { name: "Densidad de filas" })).getByRole("button", { name: "Estándar" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Compacta" }));
    expect(onChange).toHaveBeenCalledWith(28);
  });

  it("ordena filas, oculta columnas secundarias y comunica selección", () => {
    interface Client {
      id: string;
      name: string;
      type: string;
    }
    const rows: Client[] = [
      { id: "z", name: "Zeta", type: "Empresa" },
      { id: "a", name: "Alfa", type: "Persona" },
    ];
    const columns: DenseColumn<Client>[] = [
      { key: "name", header: "Nombre", render: (row) => row.name, sortValue: (row) => row.name },
      { key: "type", header: "Tipo", render: (row) => row.type, secondary: true },
    ];
    const onSelect = vi.fn();
    render(
      <DenseTable
        label="Clientes"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        selectedKey="a"
        onSelect={onSelect}
        inspectorOpen
        footer={<DenseFooter count={2} noun="clientes" hint="Cartera activa" />}
      />,
    );

    const table = screen.getByRole("table", { name: "Clientes" });
    expect(within(table).queryByRole("columnheader", { name: "Tipo" })).not.toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: "Nombre" }));
    expect(within(table).getByRole("columnheader", { name: /Nombre/ })).toHaveAttribute("aria-sort", "ascending");
    expect(table.querySelector("tbody tr")?.getAttribute("data-row-key")).toBe("a");

    const selectedRow = table.querySelector('tr[data-row-key="a"]');
    expect(selectedRow).toHaveAttribute("aria-current", "true");
    expect(selectedRow).toHaveClass("dense-row--selected");
    fireEvent.click(selectedRow!);
    expect(onSelect).toHaveBeenLastCalledWith(null);
    fireEvent.keyDown(selectedRow!, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenLastCalledWith("z");
    expect(screen.getByText("2 clientes")).toBeInTheDocument();
    expect(screen.getByLabelText("Atajos de teclado")).toBeInTheDocument();
  });

  it("muestra los datos del inspector, omite nulos y anuncia carga", () => {
    const onClose = vi.fn();
    const facts: ReadonlyArray<[string, ReactNode]> = [
      ["Identificador", "CLI-1"],
      ["Dato opcional", null],
    ];
    render(
      <>
        <DenseWorkspace
          panelId="client-panel"
          inspector={
            <Inspector
              label="Detalle del cliente"
              eyebrow="Ficha"
              title="Cliente Uno"
              subtitle="Estudio Demo"
              leading={<span>CU</span>}
              banner={<p>Revisión pendiente</p>}
              onClose={onClose}
              footer={<button type="button">Guardar</button>}
            >
              <InspectorSection title="Identificación">
                <InspectorFacts items={facts} />
              </InspectorSection>
            </Inspector>
          }
        >
          <p>Tabla</p>
        </DenseWorkspace>
        <DenseLoading label="Cargando clientes" />
      </>,
    );

    expect(document.querySelector(".dense-work")).toHaveClass("dense-work--inspector");
    const inspector = screen.getByRole("complementary", { name: "Detalle del cliente" });
    expect(within(inspector).getByRole("heading", { name: "Cliente Uno" })).toBeInTheDocument();
    expect(within(inspector).getByText("CLI-1")).toBeInTheDocument();
    expect(within(inspector).queryByText("Dato opcional")).not.toBeInTheDocument();
    fireEvent.click(within(inspector).getByRole("button", { name: "Cerrar detalle" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando clientes");
  });

  it("persiste la densidad elegida y normaliza búsquedas", () => {
    function DensityProbe() {
      const [density, setDensity] = useDensity();
      return (
        <>
          <output aria-label="Densidad actual">{density}</output>
          <button type="button" onClick={() => setDensity(28)}>Compactar</button>
        </>
      );
    }

    render(<DensityProbe />);
    expect(screen.getByLabelText("Densidad actual")).toHaveTextContent("32");
    fireEvent.click(screen.getByRole("button", { name: "Compactar" }));
    expect(screen.getByLabelText("Densidad actual")).toHaveTextContent("28");
    expect(window.localStorage.getItem("contable.dense.rowHeight")).toBe("28");
    expect(normalizeSearch("  ÁRBOL  ")).toBe("arbol");
  });

  it("activa atajos de búsqueda, alta y cierre", () => {
    const onNew = vi.fn();
    const onEscape = vi.fn();

    function ShortcutProbe() {
      const searchRef = useRef<HTMLInputElement>(null);
      useDenseShortcuts({ searchRef, onNew, onEscape });
      return <input ref={searchRef} aria-label="Buscar" />;
    }

    render(<ShortcutProbe />);
    const search = screen.getByRole("textbox", { name: "Buscar" });
    fireEvent.keyDown(document.body, { key: "/" });
    expect(search).toHaveFocus();
    fireEvent.keyDown(document.body, { key: "N" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onNew).toHaveBeenCalledOnce();
    expect(onEscape).toHaveBeenCalledOnce();
  });
});
