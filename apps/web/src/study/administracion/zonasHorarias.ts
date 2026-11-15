const ARGENTINA_TIME_ZONES = [
  "America/Argentina/Buenos_Aires",
  "America/Argentina/Catamarca",
  "America/Argentina/Cordoba",
  "America/Argentina/Jujuy",
  "America/Argentina/La_Rioja",
  "America/Argentina/Mendoza",
  "America/Argentina/Rio_Gallegos",
  "America/Argentina/Salta",
  "America/Argentina/San_Juan",
  "America/Argentina/San_Luis",
  "America/Argentina/Tucuman",
  "America/Argentina/Ushuaia",
];

const TIME_ZONE_GROUP_LABELS: Record<string, string> = {
  Africa: "África",
  America: "América",
  Antarctica: "Antártida",
  Arctic: "Ártico",
  Asia: "Asia",
  Atlantic: "Atlántico",
  Australia: "Australia",
  Etc: "Otros",
  Europe: "Europa",
  Indian: "Océano Índico",
  Pacific: "Pacífico",
  UTC: "UTC",
};

interface TimeZoneOption {
  value: string;
  label: string;
}

interface TimeZoneGroup {
  key: string;
  label: string;
  options: TimeZoneOption[];
}

function timeZoneCityName(timeZone: string): string {
  return timeZone.split("/").at(-1)?.replaceAll("_", " ") ?? timeZone;
}

const TIME_ZONE_LABEL_CACHE = new Map<string, string>();

export function timeZoneLabel(timeZone: string): string {
  const cached = TIME_ZONE_LABEL_CACHE.get(timeZone);
  if (cached) return cached;
  const city = timeZoneCityName(timeZone);
  try {
    const offset = new Intl.DateTimeFormat("es-AR", {
      timeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    const label = offset ? `${city} (${offset})` : city;
    TIME_ZONE_LABEL_CACHE.set(timeZone, label);
    return label;
  } catch {
    TIME_ZONE_LABEL_CACHE.set(timeZone, city);
    return city;
  }
}

const SUPPORTED_TIME_ZONES =
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : ARGENTINA_TIME_ZONES;
const TIME_ZONE_OPTIONS = Array.from(
  new Set([...SUPPORTED_TIME_ZONES, "UTC", ...ARGENTINA_TIME_ZONES]),
).sort((left, right) => timeZoneCityName(left).localeCompare(timeZoneCityName(right), "es-AR"));

export function groupTimeZones(currentTimeZone?: string): TimeZoneGroup[] {
  const zones = currentTimeZone && !TIME_ZONE_OPTIONS.includes(currentTimeZone)
    ? [...TIME_ZONE_OPTIONS, currentTimeZone]
    : TIME_ZONE_OPTIONS;
  const labelCounts = new Map<string, number>();
  for (const timeZone of zones) {
    const label = timeZoneLabel(timeZone);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  const groups = new Map<string, TimeZoneOption[]>();
  for (const timeZone of zones) {
    const key = timeZone.split("/")[0] ?? "UTC";
    const baseLabel = timeZoneLabel(timeZone);
    const parts = timeZone.split("/");
    const qualifier = parts.length > 1 ? parts[parts.length - 2] ?? key : key;
    const label = (labelCounts.get(baseLabel) ?? 0) > 1
      ? `${baseLabel} · ${TIME_ZONE_GROUP_LABELS[qualifier] ?? qualifier.replaceAll("_", " ")}`
      : baseLabel;
    groups.set(key, [...(groups.get(key) ?? []), { value: timeZone, label }]);
  }
  return [...groups.entries()]
    .map(([key, options]) => ({
      key,
      label: TIME_ZONE_GROUP_LABELS[key] ?? key,
      options,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "es-AR"));
}
