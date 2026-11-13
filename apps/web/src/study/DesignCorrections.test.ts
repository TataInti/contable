import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const denseStyles = readSource("../../packages/design-system/src/Dense.css");
const drawerStyles = readSource("../../packages/design-system/src/ActionDrawer.css");
const studyStyles = readSource("src/study/study.css");
const onboardingSource = readSource("src/study/StudyOnboardingFiscal.tsx");

describe("regresiones visuales F3b-3", () => {
  it("mantiene inicial y razón social en una línea dentro de la acción de Cliente", () => {
    expect(denseStyles).toMatch(/\.dense-name-action\s*\{[^}]*justify-content:\s*flex-start;/s);
    expect(denseStyles).toMatch(
      /\.dense-name-action > \.ds-button__content\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*gap:\s*var\(--ds-space-2\);/s,
    );
  });

  it("deja Alta de cliente con el alto completo y scroll interno del drawer estándar", () => {
    const standardPanel = drawerStyles.match(/\.action-drawer__panel\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(standardPanel).toMatch(/height:\s*100%;/);
    expect(standardPanel).toMatch(/max-height:\s*100dvh;/);
    expect(studyStyles).not.toMatch(
      /\.action-drawer__panel:has\(#client-create-form\)\s*\{[^}]*\b(?:align-self|height|max-height):/s,
    );
    expect(studyStyles).not.toMatch(
      /\.action-drawer__panel:has\(#client-create-form\)\s+\.action-drawer__content\s*\{/,
    );
    expect(drawerStyles).toMatch(/\.action-drawer__content\s*\{[^}]*flex:\s*1 1 auto;[^}]*overflow-y:\s*auto;/s);
    expect(drawerStyles).toMatch(/\.action-drawer__footer\s*\{[^}]*flex:\s*0 0 auto;/s);
  });

  it("renderiza una sola etiqueta Salir y conserva el tamaño row en el botón", () => {
    const shell = readSource("src/shells/StudyShell.tsx");
    const shellStyles = readSource("src/shells/StudyShell.css");
    expect(studyStyles).not.toMatch(/\.study__logout::after\s*\{[^}]*content:\s*["']Salir["'];/s);
    expect(shell).toMatch(/className="study__logout"[\s\S]*?size="row"[\s\S]*?>\s*Salir\s*<\/Button>/);
    expect(shellStyles).toMatch(/\.study__logout\s*\{[^}]*min-height:\s*var\(--ds-control-height-sm\);/s);
  });

  it("da 40 px a la primaria de cabecera y conserva el objetivo coarse", () => {
    expect(denseStyles).toMatch(
      /\.dense-head__actions \.ds-button--primary\s*\{[^}]*min-block-size:\s*var\(--ds-control-height-md\);/s,
    );
    expect(denseStyles).toMatch(
      /@media \(pointer: coarse\)\s*\{[^}]*\.dense-head__actions \.ds-button--primary\s*\{[^}]*min-block-size:\s*var\(--ds-touch-target\);/s,
    );
  });

  it("usa el anillo estándar de foco en los selects de contexto", () => {
    const contextStyles = readSource("src/shells/ContextBar.css");
    const focusRule = contextStyles.match(/\.ctxbar__input:focus-visible\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(focusRule).toMatch(/outline:\s*var\(--ds-focus-width\) solid var\(--ds-color-focus\);/);
    expect(focusRule).toMatch(/outline-offset:\s*var\(--ds-focus-offset\);/);
  });

  it("sube el contraste de CUIT y Condición IVA en la fila seleccionada", () => {
    expect(studyStyles).toMatch(
      /\.dense-row--selected \.client-list__cuit-column,[\s\S]*?\.dense-row--selected \.client-list__vat-column\s*\{[^}]*color:\s*var\(--ds-color-text-muted\);/,
    );
  });

  it("presenta Principal como atributo neutro, sin StatusBadge", () => {
    expect(onboardingSource).toMatch(
      /!row\.validTo && row\.isPrimary\s*\?\s*\([\s\S]*?<span className="muted-copy">Principal<\/span>/,
    );
  });
});
