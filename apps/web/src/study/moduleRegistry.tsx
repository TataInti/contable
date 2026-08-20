import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { IconName } from "../ui/Icon";

export type StudyModuleStatus = "released" | "limited" | "not_released";
export type StudyNavigationGroup =
  | "General"
  | "Preparación"
  | "Ejecución"
  | "Análisis"
  | "Configuración";

export interface StudyModuleRequirements {
  firm?: boolean;
  client?: boolean;
  period?: boolean;
}

export interface StudyModule {
  id: string;
  path: `/${string}`;
  label: string;
  eyebrow?: string;
  icon: IconName;
  navigationGroup: StudyNavigationGroup;
  requiredCapability?: string;
  requirements: StudyModuleRequirements;
  status: StudyModuleStatus;
  end?: boolean;
  component: LazyExoticComponent<ComponentType>;
}

export const STUDY_NAVIGATION_GROUPS: readonly StudyNavigationGroup[] = [
  "General",
  "Preparación",
  "Ejecución",
  "Análisis",
  "Configuración",
];

/**
 * Fuente única de verdad para las secciones internas del estudio.
 *
 * Un módulo liberado se usa tanto para crear su ruta como para renderizar la
 * navegación. Así evitamos pantallas compiladas que no se pueden alcanzar.
 */
export const STUDY_MODULES: readonly StudyModule[] = [
  {
    id: "inicio",
    path: "/",
    label: "Inicio",
    icon: "home",
    navigationGroup: "General",
    requirements: { firm: true },
    status: "released",
    end: true,
    component: lazy(() =>
      import("./StudyDashboard").then((module) => ({ default: module.StudyDashboard })),
    ),
  },
  {
    id: "clientes",
    path: "/clientes",
    label: "Clientes",
    icon: "users",
    navigationGroup: "General",
    requiredCapability: "client.read",
    requirements: { firm: true },
    status: "released",
    component: lazy(() =>
      import("./StudyClientes").then((module) => ({ default: module.StudyClientes })),
    ),
  },
  {
    id: "bandeja",
    path: "/bandeja",
    label: "Bandeja documental",
    icon: "inbox",
    navigationGroup: "Preparación",
    requiredCapability: "client.read",
    requirements: { firm: true, client: true },
    status: "released",
    component: lazy(() =>
      import("./StudyBandeja").then((module) => ({ default: module.StudyBandeja })),
    ),
  },
  {
    id: "configuracion-fiscal",
    path: "/configuracion-fiscal",
    label: "Configuración fiscal",
    icon: "settings",
    navigationGroup: "Preparación",
    requiredCapability: "tax.profile.read",
    requirements: { firm: true, client: true },
    status: "released",
    component: lazy(() =>
      import("./StudyOnboardingFiscal").then((module) => ({
        default: module.StudyOnboardingFiscal,
      })),
    ),
  },
  {
    id: "trabajo",
    path: "/trabajo",
    label: "Trabajo",
    icon: "tasks",
    navigationGroup: "Ejecución",
    requiredCapability: "client.read",
    requirements: { firm: true, client: true },
    status: "released",
    component: lazy(() =>
      import("./StudyTrabajo").then((module) => ({ default: module.StudyTrabajo })),
    ),
  },
  {
    id: "contabilidad",
    path: "/contabilidad",
    label: "Contabilidad",
    icon: "briefcase",
    navigationGroup: "Ejecución",
    requiredCapability: "client.read",
    requirements: { firm: true, client: true, period: true },
    status: "released",
    component: lazy(() =>
      import("./StudyContabilidad").then((module) => ({ default: module.StudyContabilidad })),
    ),
  },
  {
    id: "liquidaciones",
    path: "/liquidaciones",
    label: "Liquidaciones",
    icon: "reports",
    navigationGroup: "Ejecución",
    requiredCapability: "tax.settlements.read",
    requirements: { firm: true, client: true, period: true },
    status: "released",
    component: lazy(() =>
      import("./StudyLiquidaciones").then((module) => ({ default: module.StudyLiquidaciones })),
    ),
  },
  {
    id: "expediente-mensual",
    path: "/expediente-mensual",
    label: "Expediente mensual",
    icon: "reports",
    navigationGroup: "Ejecución",
    requiredCapability: "tax.settlements.read",
    requirements: { firm: true, client: true, period: true },
    status: "released",
    component: lazy(() =>
      import("./StudyExpedienteMensual").then((module) => ({
        default: module.StudyExpedienteMensual,
      })),
    ),
  },
  {
    id: "rentabilidad",
    path: "/rentabilidad",
    label: "Rentabilidad",
    icon: "trending",
    navigationGroup: "Análisis",
    requiredCapability: "profitability.read",
    requirements: { firm: true, client: true, period: true },
    status: "released",
    component: lazy(() =>
      import("./StudyRentabilidad").then((module) => ({ default: module.StudyRentabilidad })),
    ),
  },
  {
    id: "reportes",
    path: "/reportes",
    label: "Reportes y análisis",
    icon: "chart",
    navigationGroup: "Análisis",
    requiredCapability: "report.run",
    requirements: { firm: true, client: true, period: true },
    status: "released",
    component: lazy(() =>
      import("./StudyReportes").then((module) => ({ default: module.StudyReportes })),
    ),
  },
  {
    id: "asistente",
    path: "/asistente",
    label: "Asistente contable",
    icon: "assistant",
    navigationGroup: "Análisis",
    requiredCapability: "ai.use",
    requirements: { firm: true, client: true, period: true },
    status: "released",
    component: lazy(() =>
      import("./StudyAsistente").then((module) => ({ default: module.StudyAsistente })),
    ),
  },
  {
    id: "administracion",
    path: "/administracion",
    label: "Administración",
    icon: "settings",
    navigationGroup: "Configuración",
    requiredCapability: "firm.manage",
    requirements: { firm: true },
    status: "released",
    component: lazy(() =>
      import("./StudyAdministracion").then((module) => ({ default: module.StudyAdministracion })),
    ),
  },
] as const;

export function modulesForNavigation(capabilities: ReadonlySet<string>): readonly StudyModule[] {
  return STUDY_MODULES.filter(
    (module) =>
      module.status === "released" &&
      (!module.requiredCapability || capabilities.has(module.requiredCapability)),
  );
}

export function moduleById(id: StudyModule["id"]): StudyModule | undefined {
  return STUDY_MODULES.find((module) => module.id === id);
}
