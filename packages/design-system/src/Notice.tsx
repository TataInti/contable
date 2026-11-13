import type { HTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon.js";
import "./Notice.css";

export type NoticeTone = "info" | "success" | "warning" | "error";

export interface NoticeProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title" | "role" | "aria-live"> {
  tone?: NoticeTone;
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}

const ICON_BY_TONE: Record<NoticeTone, IconName> = {
  info: "info",
  success: "check",
  warning: "alert",
  error: "close",
};

export function Notice({ tone = "info", title, action, children, className, ...rest }: NoticeProps) {
  const isError = tone === "error";

  return (
    <div
      className={`ds-notice ds-notice--${tone}${className ? ` ${className}` : ""}`}
      role={isError ? "alert" : "status"}
      aria-live={isError ? undefined : "polite"}
      {...rest}
    >
      <span className="ds-notice__icon" aria-hidden="true">
        <Icon name={ICON_BY_TONE[tone]} size={18} />
      </span>
      <div className="ds-notice__content">
        {title ? <strong className="ds-notice__title">{title}</strong> : null}
        <div className="ds-notice__message">{children}</div>
        {action ? <div className="ds-notice__action">{action}</div> : null}
      </div>
    </div>
  );
}