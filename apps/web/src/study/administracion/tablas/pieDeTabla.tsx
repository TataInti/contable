import { ShortcutHint } from "../../../ui/Dense";

export const footerWith = (hint: string) => (
  <>
    <span>{hint}</span>
    <span className="dense-table-foot__spacer" />
    <ShortcutHint
      items={[
        ["/", "buscar"],
        ["N", "nuevo"],
        ["Esc", "cerrar"],
      ]}
    />
  </>
);
