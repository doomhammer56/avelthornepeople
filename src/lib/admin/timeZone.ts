export function validTimeZone(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(value)
  )
    return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
function formatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
  });
}
export function zonedDateTime(
  instant: string | null,
  timeZone: string,
): string {
  if (!instant) return "";
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}`;
}
export class ScheduleTimeError extends Error {
  readonly code: "invalid" | "ambiguous_time" | "nonexistent_time";
  constructor(code: ScheduleTimeError["code"]) {
    super("Invalid schedule time");
    this.code = code;
  }
}
// Intl supplies the zone rules. Candidate offsets on either side of the date
// cover daylight-saving transitions without assuming a fixed offset or one hour.
export function scheduleInstant(
  raw: string,
  timeZone: string,
  originalInstant?: string | null,
): string | null {
  if (!raw) return null;
  if (
    !validTimeZone(timeZone) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(raw)
  )
    throw new ScheduleTimeError("invalid");
  const wall = new Date(`${raw}Z`),
    epoch = wall.getTime();
  if (
    !Number.isFinite(epoch) ||
    wall.toISOString().slice(0, 16) !== raw.slice(0, 16) ||
    (raw.length >= 19 && wall.toISOString().slice(0, 19) !== raw.slice(0, 19))
  )
    throw new ScheduleTimeError("invalid");
  const normalized = wall.toISOString().slice(0, -1);
  if (
    originalInstant &&
    zonedDateTime(originalInstant, timeZone) === normalized
  )
    return new Date(originalInstant).toISOString();
  const offsets = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = epoch + hours * 3600000;
    offsets.add(
      Date.parse(
        `${zonedDateTime(new Date(sample).toISOString(), timeZone)}Z`,
      ) - sample,
    );
  }
  const candidates = [...offsets]
    .map((offset) => new Date(epoch - offset).toISOString())
    .filter((instant) => zonedDateTime(instant, timeZone) === normalized);
  if (candidates.length === 0) throw new ScheduleTimeError("nonexistent_time");
  if (candidates.length > 1) throw new ScheduleTimeError("ambiguous_time");
  return candidates[0];
}
export function availableTimeZones(current: string) {
  const zones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  return [...new Set(["UTC", current, ...zones])].sort();
}
