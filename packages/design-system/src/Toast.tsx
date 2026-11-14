import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./Icon.js";
import "./Toast.css";

/**
 * Notificaciones emergentes de la aplicación.
 *
 * Es el único canal para decir cómo terminó una acción: éxito, que se va solo,
 * o error, que queda hasta cerrarlo. Se monta una vez (`ToastProvider`) y cada
 * pantalla avisa con `useNotify()`, sin dibujar nada propio.
 */

export type ToastTone = "success" | "error" | "info";

export interface ToastOptions {
  /** Título breve sobre el mensaje. */
  title?: string;
  /** Milisegundos hasta cerrarse sola; `null` la deja hasta que se cierre. */
  duration?: number | null;
}

export interface Notifier {
  success: (message: string, options?: ToastOptions) => string;
  error: (message: string, options?: ToastOptions) => string;
  info: (message: string, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
}

interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
  title?: string;
  duration: number | null;
}

const DEFAULT_DURATION: Record<ToastTone, number | null> = {
  success: 5000,
  info: 6000,
  // Un error no se pierde: queda hasta que la persona lo cierra.
  error: null,
};

const ICON_BY_TONE: Record<ToastTone, IconName> = {
  success: "check",
  error: "alert",
  info: "info",
};

const NOOP_NOTIFIER: Notifier = {
  success: () => "",
  error: () => "",
  info: () => "",
  dismiss: () => undefined,
};

const ToastContext = createContext<Notifier>(NOOP_NOTIFIER);

/** Devuelve el avisador de la aplicación. Fuera del proveedor no hace nada. */
export function useNotify(): Notifier {
  return useContext(ToastContext);
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (toast.duration === null || paused) return undefined;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [onDismiss, paused, toast.duration, toast.id]);

  const isError = toast.tone === "error";
  return (
    <div
      className={`ds-toast ds-toast--${toast.tone}`}
      role={isError ? "alert" : "status"}
      aria-live={isError ? undefined : "polite"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="ds-toast__icon" aria-hidden="true">
        <Icon name={ICON_BY_TONE[toast.tone]} size={18} />
      </span>
      <div className="ds-toast__content">
        {toast.title ? <strong className="ds-toast__title">{toast.title}</strong> : null}
        <span className="ds-toast__message">{toast.message}</span>
      </div>
      <button
        type="button"
        className="ds-toast__close"
        aria-label="Cerrar notificación"
        onClick={() => onDismiss(toast.id)}
      >
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}

export function ToastProvider({
  children,
  max = 4,
}: {
  children: ReactNode;
  /** Cantidad máxima de notificaciones visibles a la vez. */
  max?: number;
}) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string, options: ToastOptions = {}) => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      const item: ToastItem = {
        id,
        tone,
        message,
        ...(options.title ? { title: options.title } : {}),
        duration: options.duration === undefined ? DEFAULT_DURATION[tone] : options.duration,
      };
      setToasts((current) => {
        // El mismo aviso repetido reemplaza al anterior en lugar de apilarse.
        const withoutDuplicate = current.filter(
          (toast) => !(toast.tone === tone && toast.message === message),
        );
        return [...withoutDuplicate, item].slice(-max);
      });
      return id;
    },
    [max],
  );

  const notifier = useMemo<Notifier>(
    () => ({
      success: (message, options) => push("success", message, options),
      error: (message, options) => push("error", message, options),
      info: (message, options) => push("info", message, options),
      dismiss,
    }),
    [dismiss, push],
  );

  return (
    <ToastContext.Provider value={notifier}>
      {children}
      <div className="ds-toast-region" role="region" aria-label="Notificaciones">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
