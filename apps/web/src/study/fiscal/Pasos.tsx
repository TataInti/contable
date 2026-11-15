import { Button } from "@contable/design-system";
import { FISCAL_STEPS, STEP_TAB, type FiscalStep, type FiscalTab } from "./utilidades";

type Props = {
  nextRequiredStep: { key: FiscalStep; label: string };
  stepCompletion: Record<FiscalStep, boolean>;
  stepStatusLabel: (key: FiscalStep) => string;
  setTab: (tab: FiscalTab) => void;
};

export function PasosFiscales({ nextRequiredStep, stepCompletion, stepStatusLabel, setTab }: Props) {
  return (
    <nav className="fiscal-progress" aria-label="Pasos del onboarding fiscal">
      <ol className="fiscal-progress__list">
        {FISCAL_STEPS.map((item, index) => (
          <li key={item.key}>
            <Button
              type="button"
              variant="text"
              size="row"
              className="fiscal-progress__step"
              aria-current={nextRequiredStep.key === item.key ? "step" : undefined}
              onClick={() => setTab(STEP_TAB[item.key])}
            >
              <span className="fiscal-progress__marker" aria-hidden="true">{index + 1}</span>
              <span>{item.label}</span>
              <span className={`fiscal-progress__status${stepCompletion[item.key] ? " fiscal-progress__status--done" : ""}`}>
                {stepStatusLabel(item.key)}
              </span>
            </Button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
