import { useId, type ReactNode } from "react";

export const ICON_NAMES = [
  "home",
  "users",
  "inbox",
  "briefcase",
  "tasks",
  "reports",
  "chart",
  "assistant",
  "spark",
  "settings",
  "portal",
  "building",
  "logout",
  "chevron",
  "menu",
  "close",
  "search",
  "calendar",
  "file",
  "upload",
  "message",
  "shield",
  "check",
  "alert",
  "download",
  "plus",
  "arrow-right",
  "trending",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export interface IconProps {
  name: IconName;
  size?: number | string;
  strokeWidth?: number;
  className?: string;
  title?: string;
}

const briefcaseGlyph = (
  <>
    <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" />
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M3 12.5c2.8 1.2 5.8 1.8 9 1.8s6.2-.6 9-1.8M10 13.8v1.7h4v-1.7" />
  </>
);

const chartGlyph = (
  <>
    <path d="M4 19V5M4 19h16" />
    <path d="m7.5 15 3.2-3.6 2.8 2.2L19 7" />
    <path d="M16 7h3v3" />
  </>
);

const sparkGlyph = (
  <>
    <path d="M12 3.5c.5 3.1 2.4 5 5.5 5.5-3.1.5-5 2.4-5.5 5.5-.5-3.1-2.4-5-5.5-5.5 3.1-.5 5-2.4 5.5-5.5Z" />
    <path d="M18.5 14.5c.2 1.5 1.1 2.4 2.5 2.5-1.4.2-2.3 1-2.5 2.5-.2-1.5-1.1-2.3-2.5-2.5 1.4-.1 2.3-1 2.5-2.5ZM5 15.5c.2 1 1 1.8 2 2-1 .2-1.8 1-2 2-.2-1-1-1.8-2-2 1-.2 1.8-1 2-2Z" />
  </>
);

const buildingGlyph = (
  <>
    <path d="M4 20V6l8-3 8 3v14M2.5 20h19" />
    <path d="M8 8h1M8 11.5h1M8 15h1M15 8h1M15 11.5h1M15 15h1M10 20v-3h4v3" />
  </>
);

const ICON_GLYPHS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="m3 10 9-7 9 7" />
      <path d="M5 9.5V21h14V9.5M9.5 21v-7h5v7" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20v-1.5A4.5 4.5 0 0 1 8 14h2a4.5 4.5 0 0 1 4.5 4.5V20" />
      <path d="M15 5.4a3 3 0 0 1 0 5.2M17 14a4.5 4.5 0 0 1 3.5 4.4V20" />
    </>
  ),
  inbox: (
    <>
      <path d="M4.5 4h15l2 10.5A2.1 2.1 0 0 1 19.4 17H4.6a2.1 2.1 0 0 1-2.1-2.5L4.5 4Z" />
      <path d="M3 13h5l2 3h4l2-3h5M8 8h8" />
    </>
  ),
  briefcase: briefcaseGlyph,
  tasks: (
    <>
      <path d="m4 6 1.5 1.5L8.5 4.5M4 12l1.5 1.5 3-3M4 18l1.5 1.5 3-3" />
      <path d="M11 6h9M11 12h9M11 18h9" />
    </>
  ),
  reports: chartGlyph,
  chart: chartGlyph,
  assistant: sparkGlyph,
  spark: sparkGlyph,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  portal: buildingGlyph,
  building: buildingGlyph,
  logout: (
    <>
      <path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5" />
      <path d="M14 8l4 4-4 4M8 12h10" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m5 5 14 14M19 5 5 19" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18M7 14h2M11 14h2M15 14h2M7 18h2M11 18h2" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h4M9 13h6M9 17h6" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
    </>
  ),
  message: (
    <>
      <path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2.2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3Z" />
      <path d="M7 9h10M7 13h6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.5 6v5.2c0 4.7 3.1 8 7.5 9.8 4.4-1.8 7.5-5.1 7.5-9.8V6Z" />
      <path d="m8.5 12 2.2 2.2 4.8-4.8" />
    </>
  ),
  check: <path d="m4.5 12.5 4.7 4.7L19.5 7" />,
  alert: (
    <>
      <path d="M10.3 4.5 2.7 18a2 2 0 0 0 1.8 3h15a2 2 0 0 0 1.8-3L13.7 4.5a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v5M12 18h.01" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12M7.5 11.5 12 16l4.5-4.5" />
      <path d="M5 19h14" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  "arrow-right": <path d="M4 12h16M14 6l6 6-6 6" />,
  trending: (
    <>
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
};

export function Icon({ name, size = 20, strokeWidth = 1.8, className, title }: IconProps) {
  const generatedTitleId = useId();
  const accessibleTitle = title?.trim();

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={accessibleTitle ? "img" : undefined}
      aria-labelledby={accessibleTitle ? generatedTitleId : undefined}
      aria-hidden={accessibleTitle ? undefined : true}
      focusable="false"
    >
      {accessibleTitle ? <title id={generatedTitleId}>{accessibleTitle}</title> : null}
      {ICON_GLYPHS[name]}
    </svg>
  );
}
