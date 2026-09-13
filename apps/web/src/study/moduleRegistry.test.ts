import { describe, expect, it } from "vitest";
import { STUDY_MODULES, STUDY_NAVIGATION_GROUPS, modulesForNavigation } from "./moduleRegistry";

describe("registro de módulos del estudio", () => {
  it("da una ruta y una entrada de navegación a cada módulo liberado", () => {
    for (const module of STUDY_MODULES.filter((item) => item.status === "released")) {
      expect(module.path).toMatch(/^\//);
      expect(module.path).not.toContain(":");
      expect(STUDY_NAVIGATION_GROUPS).toContain(module.navigationGroup);
      expect(module.component).toBeDefined();
    }
  });

  it("no duplica rutas canónicas", () => {
    const paths = STUDY_MODULES.map((module) => module.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("muestra cada módulo liberado cuando el rol tiene la capacidad requerida", () => {
    const capabilities = new Set(
      STUDY_MODULES.flatMap((module) => (module.requiredCapability ? [module.requiredCapability] : [])),
    );
    const visible = modulesForNavigation(capabilities).map((module) => module.id);

    expect(visible).toEqual(STUDY_MODULES.filter((module) => module.status === "released").map((module) => module.id));
  });

  it("no ofrece módulos con capacidad ausente", () => {
    const visible = modulesForNavigation(new Set()).map((module) => module.id);
    expect(visible).toEqual(["inicio"]);
  });

  it("separa el acceso del estudio del administrador general", () => {
    const studyAdmin = modulesForNavigation(new Set(["firm.users.manage"])).map((module) => module.id);
    const platformAdmin = modulesForNavigation(new Set(["platform.modules.manage"])).map((module) => module.id);
    expect(studyAdmin).toContain("usuarios");
    expect(studyAdmin).not.toContain("administracion-plataforma");
    expect(platformAdmin).toContain("administracion-plataforma");
    expect(platformAdmin).not.toContain("usuarios");
  });

  it("mantiene contabilidad y reportes fuera de la navegación aunque el rol tenga todas las capacidades", () => {
    const capabilities = new Set(
      STUDY_MODULES.flatMap((module) => (module.requiredCapability ? [module.requiredCapability] : [])),
    );
    const visible = modulesForNavigation(capabilities).map((module) => module.id);

    expect(visible).not.toContain("contabilidad");
    expect(visible).not.toContain("reportes");
  });
});
