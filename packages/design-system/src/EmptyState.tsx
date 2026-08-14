import type { HTMLAttributes, ReactNode } from "react";
import "./EmptyState.css";

export type EmptyStateSize = "regular" | "compact";

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: string;
  description?: string;
  action?: ReactNode;
  size?: EmptyStateSize;
}

export function EmptyState({
  title,
  description,
  action,
  size = "regular",
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div className={`ds-empty ds-empty--${size}${className ? ` ${className}` : ""}`} {...rest}>
      <span className="ds-empty__visual" aria-hidden="true" />
      <h3 className="ds-empty__title">{title}</h3>
      {description ? <p className="ds-empty__description">{description}</p> : null}
      {action ? <div className="ds-empty__action">{action}</div> : null}
    </div>
  );
}
