import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  loadingLabel,
  disabled,
  className,
  "aria-label": ariaLabel,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={`ds-button ds-button--${variant} ds-button--${size}${className ? ` ${className}` : ""}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={loading && loadingLabel ? loadingLabel : ariaLabel}
      data-loading={loading || undefined}
    >
      {loading ? <span className="ds-button__spinner" aria-hidden="true" /> : null}
      <span className="ds-button__content">{children}</span>
    </button>
  );
}
