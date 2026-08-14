# AnaliticaStudio — Copilot Instructions

Responde en el idioma del usuario (generalmente Español). Mantén las respuestas técnicas y orientadas al contexto de negocio definido abajo.

Este repositorio contiene el sitio marketing (`frontend/`) y la plataforma SaaS (`platform/`) de AnaliticaStudio.

---
## Usage Instructions

USO OBLIGATORIO: Aplicar siempre las reglas de eficiencia de `.github/prompts/caveman.prompt.md`. El modo "caveman full" está activo por defecto para garantizar respuestas breves, directas y sin relleno.

## Design Context

### Shared Brand Context

Decisores y líderes en empresas medianas a grandes (50–800+ empleados) en Latinoamérica, con fuerte foco en Argentina/Tucumán. Incluye gerentes de área, directores de operaciones, analistas senior y CEOs de PyMEs en sectores como agroindustria, manufactura, comercio y servicios.

Job to be done: _"Dame una visión clara de lo que está pasando en mi empresa para poder actuar con confianza."_

**Tres palabras:** Estratégico · Confiable · Sofisticado

**Tagline:** _"La mejor manera de predecir el futuro, es crearlo."_

**Tono:** Directo y preciso, consultor experto sin jerga innecesaria. Confianza sin arrogancia. Calor humano detrás de los datos.

**Constantes compartidas:**
- BI = `#0066ff`
- IA = `#7c3aed`
- people/success = `#10b981`

---

### Surface Routing

- **`frontend/`**:
  usar la convención de [`.impeccable-web.md`](../../.impeccable-web.md)
  tono editorial, aspiracional, cálido, light-only, serif + dorado permitidos

- **`platform/`**:
  usar la convención de [`.impeccable-platform.md`](../../.impeccable-platform.md)
  workspace ejecutivo moderno, `light/dark/system`, sans-first, menos cards, sin dorado como activo por defecto

---

### Guardrails

- No mezclar patrones de marketing en rutas core de producto
- No mezclar patrones de app operativa en páginas de marketing
- Si un cambio toca ambas superficies, compartir marca y tono, no la misma gramática visual

---

Ver:
- [`.impeccable.md`](../../.impeccable.md)
- [`.impeccable-web.md`](../../.impeccable-web.md)
- [`.impeccable-platform.md`](../../.impeccable-platform.md)
