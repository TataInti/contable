import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@contable/design-system";
import { Icon } from "./Icon";
import "./GuidedTour.css";

const TOUR_STORAGE_KEY = "contable-study-navigation-tour-v1";

type TourStep = {
  selector: string;
  eyebrow: string;
  title: string;
  description: string;
};

type TourRect = {
  top: number;
  left: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
};

const TOUR_STEPS: readonly TourStep[] = [
  {
    selector: "#context-bar",
    eyebrow: "Paso 1 · Contexto",
    title: "Definí el estudio, el cliente y el período",
    description:
      "El contexto activo reúne el estudio, el cliente y el período de trabajo. Cada consulta y cada tarea queda vinculada a esa referencia para mantener el foco en la gestión que estás realizando.",
  },
  {
    selector: '[data-tour="nav-general"]',
    eyebrow: "Paso 2 · Estudio",
    title: "Todo el trabajo del estudio, en una sola navegación",
    description:
      "El bloque Estudio reúne Inicio, Clientes, Bandeja documental, Trabajo, Liquidaciones, Expediente mensual y Rentabilidad. El bloque Del cliente incluye Configuración fiscal. Desde Clientes, el botón «Abrir» lleva al Resumen del cliente.",
  },
  {
    selector: '[data-tour="nav-preparacion"]',
    eyebrow: "Paso 3 · Bandeja documental",
    title: "Tené la documentación a mano",
    description:
      "La Bandeja documental reúne los archivos recibidos para consultar su estado y contar con evidencia organizada al avanzar con el trabajo.",
  },
  {
    selector: '[data-tour="nav-ejecucion"]',
    eyebrow: "Paso 4 · Trabajo y cierres",
    title: "Organizá las tareas del período",
    description:
      "Trabajo, Liquidaciones y Expediente mensual concentran los pedidos, las obligaciones y el seguimiento mensual dentro del bloque Estudio.",
  },
  {
    selector: '[data-tour="nav-analisis"]',
    eyebrow: "Paso 5 · Rentabilidad",
    title: "Analizá la rentabilidad de tu cartera",
    description:
      "Rentabilidad reúne indicadores para evaluar resultados y orientar las prioridades del estudio.",
  },
  {
    selector: '[data-tour="nav-configuracion"]',
    eyebrow: "Paso 6 · Ajustes del estudio",
    title: "Configurá los recursos del estudio",
    description:
      "El bloque colapsable agrupa Usuarios y accesos, Módulos de estudios, Reglas fiscales y Catálogos fiscales. Abrilo para gestionar cada opción según las capacidades de tu rol.",
  },
  {
    selector: '[data-tour="portal-link"]',
    eyebrow: "Paso 7 · Portal del cliente",
    title: "Conectá el estudio con el portal del cliente",
    description:
      "El Portal del cliente permite que las empresas consulten información, respondan pedidos y carguen documentación en su espacio.",
  },
];

interface GuidedTourProps {
  children?: ReactNode | ((controls: { startTour: () => void }) => ReactNode);
  onNavigationRequired?: () => void;
}

function targetForStep(step: TourStep) {
  return document.querySelector(step.selector) as HTMLElement | null;
}

function readTourState() {
  try {
    return window.localStorage.getItem(TOUR_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeTourState(value: "completed" | "dismissed") {
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, value);
  } catch {
    // El tour sigue siendo utilizable si el navegador bloquea el almacenamiento.
  }
}

export function GuidedTour({ children, onNavigationRequired }: GuidedTourProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [steps, setSteps] = useState<readonly TourStep[]>(TOUR_STEPS);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TourRect | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const currentStep = steps[stepIndex];

  const closeTour = useCallback((state: "completed" | "dismissed") => {
    writeTourState(state);
    setIsOpen(false);
    setTargetRect(null);
  }, []);

  const startTour = useCallback(() => {
    const availableSteps = TOUR_STEPS.filter((step) => targetForStep(step));
    setSteps(availableSteps.length > 0 ? availableSteps : TOUR_STEPS);
    setStepIndex(0);
    setTargetRect(null);
    setIsOpen(true);
    onNavigationRequired?.();
  }, [onNavigationRequired]);

  useEffect(() => {
    if (readTourState()) return undefined;
    const timer = window.setTimeout(startTour, 650);
    return () => window.clearTimeout(timer);
  }, [startTour]);

  useEffect(() => {
    if (!isOpen || !currentStep) return undefined;
    onNavigationRequired?.();
    return undefined;
  }, [currentStep, isOpen, onNavigationRequired]);

  useLayoutEffect(() => {
    if (!isOpen || !currentStep) return undefined;

    const target = targetForStep(currentStep);
    if (!target) {
      if (stepIndex < steps.length - 1) {
        setStepIndex((index) => index + 1);
      } else {
        closeTour("completed");
      }
      return undefined;
    }

    target.scrollIntoView?.({ block: "nearest", inline: "nearest" });

    const updateRect = () => {
      const rect = target.getBoundingClientRect();
      setTargetRect({
        top: Math.max(8, rect.top - 6),
        left: Math.max(8, rect.left - 6),
        width: rect.width + 12,
        height: rect.height + 12,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
    };

    updateRect();
    const frame = window.requestAnimationFrame?.(updateRect) ?? 0;
    const delayedFrame = window.setTimeout(updateRect, 240);
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      if (frame) window.cancelAnimationFrame?.(frame);
      window.clearTimeout(delayedFrame);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [closeTour, currentStep, isOpen, stepIndex, steps.length]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const timer = window.setTimeout(() => popoverRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeTour("dismissed");
      }
      if (event.key === "ArrowRight" && stepIndex < steps.length - 1) {
        event.preventDefault();
        setStepIndex((index) => index + 1);
      }
      if (event.key === "ArrowLeft" && stepIndex > 0) {
        event.preventDefault();
        setStepIndex((index) => index - 1);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeTour, isOpen, stepIndex, steps.length]);

  const goNext = () => {
    if (stepIndex === steps.length - 1) {
      closeTour("completed");
      return;
    }
    setStepIndex((index) => index + 1);
  };

  const popoverStyle: CSSProperties | undefined = targetRect
    ? (() => {
        const width = Math.min(360, Math.max(240, targetRect.viewportWidth - 32));
        const spaceBelow = targetRect.viewportHeight - (targetRect.top + targetRect.height);
        const showBelow = spaceBelow >= 236 || targetRect.top < 180;
        const top = showBelow
          ? targetRect.top + targetRect.height + 18
          : Math.max(16, targetRect.top - 248);
        const left = Math.max(16, Math.min(targetRect.left, targetRect.viewportWidth - width - 16));
        return { top, left, width };
      })()
    : undefined;

  const tourContent =
    isOpen && currentStep && targetRect
      ? createPortal(
          <>
            <div
              className="guided-tour__spotlight"
              aria-hidden="true"
              style={{
                width: targetRect.width,
                height: targetRect.height,
                transform: `translate3d(${targetRect.left}px, ${targetRect.top}px, 0)`,
              }}
            />
            <div
              ref={popoverRef}
              className="guided-tour__popover"
              role="dialog"
              aria-modal="false"
              aria-labelledby="guided-tour-title"
              aria-describedby="guided-tour-description"
              tabIndex={-1}
              style={popoverStyle}
              key={currentStep.selector}
            >
              <div className="guided-tour__header">
                <span className="guided-tour__eyebrow">{currentStep.eyebrow}</span>
                <Button
                  type="button"
                  className="guided-tour__close"
                  variant="ghost"
                  size="row"
                  iconOnly
                  onClick={() => closeTour("dismissed")}
                  aria-label="Cerrar tour"
                >
                  <Icon name="close" size={17} />
                </Button>
              </div>
              <div className="guided-tour__progress" aria-hidden="true">
                <span style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} />
              </div>
              <div className="guided-tour__copy" aria-live="polite">
                <h2 id="guided-tour-title">{currentStep.title}</h2>
                <p id="guided-tour-description">{currentStep.description}</p>
              </div>
              <div className="guided-tour__footer">
                <Button
                  type="button"
                  className="guided-tour__skip"
                  variant="ghost"
                  size="row"
                  onClick={() => closeTour("dismissed")}
                >
                  Saltar tour
                </Button>
                <div className="guided-tour__actions">
                  {stepIndex > 0 ? (
                    <Button
                      type="button"
                      className="guided-tour__back"
                      variant="ghost"
                      size="row"
                      onClick={() => setStepIndex((index) => index - 1)}
                    >
                      Atrás
                    </Button>
                  ) : null}
                  <Button type="button" className="guided-tour__next" variant="primary" size="row" onClick={goNext}>
                    {stepIndex === steps.length - 1 ? "Listo, empezar" : "Siguiente"}
                    {stepIndex < steps.length - 1 ? <Icon name="arrow-right" size={15} /> : null}
                  </Button>
                </div>
              </div>
            </div>
          </>,
          document.body,
        )
      : null;

  const trigger = typeof children === "function" ? children({ startTour }) : children;

  return (
    <>
      {trigger}
      {tourContent}
    </>
  );
}
