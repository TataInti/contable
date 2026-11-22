// @vitest-environment jsdom
// Datos sintéticos: nombres y CUIT inventados.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CajonPerfil } from "./CajonPerfil";
import type { PerfilInicial } from "./perfilInicial";
import type { FiscalStep, ProfileForm, TaxpayerProfileVersion } from "../utilidades";

const propuestaSrl: PerfilInicial = {
  legalName: "Cliente SINTÉTICO SRL",
  cuit: "30111111119",
  personType: "JURIDICA",
  nationalCondition: "MONOTRIBUTISTA",
  origenTipo: "forma",
};

function Montaje({ inicial, latestProfile, onSubmit }: { inicial: ProfileForm; latestProfile?: TaxpayerProfileVersion; onSubmit?: () => void }) {
  const [form, setForm] = useState<ProfileForm>(inicial);
  const [abierto, setAbierto] = useState<FiscalStep | null>("perfil");

  return (
    <CajonPerfil
      openFormStep={abierto}
      setOpenFormStep={setAbierto}
      latestProfile={latestProfile}
      createProfile={{ isPending: false, error: null, mutate: onSubmit ?? vi.fn() } as never}
      form={form}
      setForm={setForm}
      propuesta={latestProfile ? null : propuestaSrl}
    />
  );
}

const vacio: ProfileForm = { legalName: "", cuit: "", fiscalAddress: "", personType: "", nationalCondition: "", validFrom: "2026-11-22" };
const propuesto: ProfileForm = { legalName: propuestaSrl.legalName, cuit: propuestaSrl.cuit, fiscalAddress: "", personType: "JURIDICA", nationalCondition: "MONOTRIBUTISTA", validFrom: "2026-11-22" };

function pie() {
  return document.querySelector(".action-drawer__footer") as HTMLElement;
}

afterEach(() => cleanup());

describe("CajonPerfil · creación con propuesta del alta", () => {
  it("muestra los valores propuestos y la ayuda según la forma jurídica del alta", async () => {
    render(<Montaje inicial={propuesto} />);
    const dialogo = await screen.findByRole("dialog", { name: "Crear perfil fiscal" });
    expect((within(dialogo).getByLabelText("Razón social") as HTMLInputElement).value).toBe("Cliente SINTÉTICO SRL");
    expect((within(dialogo).getByLabelText("CUIT") as HTMLInputElement).value).toBe("30111111119");
    expect((within(dialogo).getByLabelText("Tipo de persona") as HTMLSelectElement).value).toBe("JURIDICA");
    expect((within(dialogo).getByLabelText("Condición nacional") as HTMLSelectElement).value).toBe("MONOTRIBUTISTA");
    expect(within(dialogo).getByText("Propuesto según la forma jurídica del alta")).toBeTruthy();
    expect((within(pie()).getByRole("button", { name: "Crear perfil" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("la ayuda «Propuesto…» desaparece cuando el usuario cambia el tipo", async () => {
    render(<Montaje inicial={propuesto} />);
    const dialogo = await screen.findByRole("dialog", { name: "Crear perfil fiscal" });
    fireEvent.change(within(dialogo).getByLabelText("Tipo de persona"), { target: { value: "FISICA" } });
    expect(within(dialogo).queryByText(/Propuesto según/)).toBeNull();
  });

  it("sin propuesta, el tipo y la condición arrancan en «Elegí…» y «Crear perfil» queda deshabilitado con el motivo visible", async () => {
    render(<Montaje inicial={vacio} />);
    const dialogo = await screen.findByRole("dialog", { name: "Crear perfil fiscal" });
    expect((within(dialogo).getByLabelText("Tipo de persona") as HTMLSelectElement).value).toBe("");
    expect((within(dialogo).getByLabelText("Condición nacional") as HTMLSelectElement).value).toBe("");
    expect((within(dialogo).getByLabelText("Tipo de persona") as HTMLSelectElement).querySelector("option")?.textContent).toBe("Elegí…");
    expect((within(pie()).getByRole("button", { name: "Crear perfil" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(pie()).getByText("Falta elegir el tipo de persona y la condición nacional para guardar.")).toBeTruthy();
  });

  it("falta solo la condición: el motivo nombra solo la condición", async () => {
    render(<Montaje inicial={{ ...propuesto, nationalCondition: "" }} />);
    await screen.findByRole("dialog", { name: "Crear perfil fiscal" });
    expect((within(pie()).getByRole("button", { name: "Crear perfil" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(pie()).getByText("Falta elegir la condición nacional para guardar.")).toBeTruthy();
  });

  it("CUIT 30 con tipo Física muestra el aviso y no bloquea el guardado", async () => {
    const onSubmit = vi.fn();
    render(<Montaje inicial={{ ...propuesto, personType: "FISICA" }} onSubmit={onSubmit} />);
    const dialogo = await screen.findByRole("dialog", { name: "Crear perfil fiscal" });
    expect(within(dialogo).getByText("El CUIT empieza con 30, que corresponde a persona jurídica. Revisá el tipo de persona.")).toBeTruthy();
    const boton = within(pie()).getByRole("button", { name: "Crear perfil" }) as HTMLButtonElement;
    expect(boton.disabled).toBe(false);
    fireEvent.click(boton);
    expect(onSubmit).toHaveBeenCalled();
  });

  it("sin contradicción no muestra aviso", async () => {
    render(<Montaje inicial={propuesto} />);
    const dialogo = await screen.findByRole("dialog", { name: "Crear perfil fiscal" });
    expect(within(dialogo).queryByText(/Revisá el tipo de persona/)).toBeNull();
  });
});

describe("CajonPerfil · nueva versión (valores guardados, sin propuesta)", () => {
  it("muestra los valores guardados de la versión vigente y ninguna propuesta", async () => {
    const latest = {
      id: "profile-1", version: 1, legalName: "Cliente SINTÉTICO SA", cuit: "20111111112", personType: "FISICA",
      nationalCondition: "EXENTO", fiscalAddress: null, status: "ACTIVE",
    } as TaxpayerProfileVersion;
    render(<Montaje inicial={{ ...vacio, legalName: latest.legalName, cuit: latest.cuit, personType: "FISICA", nationalCondition: "EXENTO" }} latestProfile={latest} />);
    const dialogo = await screen.findByRole("dialog", { name: "Crear nueva versión del perfil" });
    expect((within(dialogo).getByLabelText("Tipo de persona") as HTMLSelectElement).value).toBe("FISICA");
    expect((within(dialogo).getByLabelText("Condición nacional") as HTMLSelectElement).value).toBe("EXENTO");
    expect(within(dialogo).queryByText(/Propuesto según/)).toBeNull();
  });
});
