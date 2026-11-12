import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactElement,
  ReactNode,
  Ref,
} from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "text" | "link";
export type ButtonSize = "sm" | "md" | "row";

interface ButtonBaseProps {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  iconOnly?: boolean;
}

type ButtonNameProps =
  | { iconOnly: true; "aria-label": string }
  | { iconOnly?: false; "aria-label"?: string };

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "className" | "disabled" | "aria-label"
> & { ref?: Ref<HTMLButtonElement> };

type NativeLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "children" | "className" | "href" | "aria-label"
> & { ref?: Ref<HTMLAnchorElement> };

export type ButtonProps = ButtonBaseProps &
  ButtonNameProps &
  NativeButtonProps & {
    href?: never;
    disabled?: boolean;
    loading?: boolean;
    loadingLabel?: string;
  };

export type ButtonLinkProps = Omit<ButtonBaseProps, "iconOnly"> &
  ButtonNameProps &
  NativeLinkProps & {
    href: string;
    disabled?: never;
    loading?: never;
    loadingLabel?: never;
  };

function buttonClassName(variant: ButtonVariant, size: ButtonSize, className?: string) {
  return `ds-button ds-button--${variant} ds-button--${size}${className ? ` ${className}` : ""}`;
}

export function Button(props: ButtonProps): ReactElement;
export function Button(props: ButtonLinkProps): ReactElement;
export function Button(props: ButtonProps | ButtonLinkProps): ReactElement {
  if ("href" in props && typeof props.href === "string") {
    const {
      children,
      variant = "primary",
      size = "md",
      className,
      iconOnly = false,
      href,
      ref,
      "aria-label": ariaLabel,
      ...rest
    } = props;
    return (
      <a
        {...rest}
        ref={ref}
        href={href}
        className={`${buttonClassName(variant, size, className)}${iconOnly ? " ds-button--icon-only" : ""}`}
        aria-label={ariaLabel}
      >
        <span className="ds-button__content">{children}</span>
      </a>
    );
  }

  const {
    children,
    variant = "primary",
    size = "md",
    loading = false,
    loadingLabel,
    disabled,
    className,
    iconOnly = false,
    ref,
    "aria-label": ariaLabel,
    "aria-busy": ariaBusy,
    ...rest
  } = props as ButtonProps;
  return (
    <button
      {...rest}
      ref={ref}
      className={`${buttonClassName(variant, size, className)}${iconOnly ? " ds-button--icon-only" : ""}`}
      disabled={disabled || loading}
      aria-busy={loading || ariaBusy || undefined}
      aria-label={loading && loadingLabel ? loadingLabel : ariaLabel}
      data-loading={loading || undefined}
    >
      {loading ? <span className="ds-button__spinner" aria-hidden="true" /> : null}
      <span className="ds-button__content">{children}</span>
    </button>
  );
}
