import type { TimelineCalendar } from "./types";

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, created);
  return created;
}

function partsAt(epochMs: number, timeZone: string): LocalParts {
  const values: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  const result = {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
  if (Object.values(result).some((value) => !Number.isInteger(value))) {
    throw new Error(`cannot resolve local date parts in timezone ${timeZone}`);
  }
  return result;
}

function pseudoUtc(parts: LocalParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function localDateTimeEpochMs(parts: LocalParts, timeZone: string): number {
  const target = pseudoUtc(parts);
  let guess = target;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const observed = partsAt(guess, timeZone);
    const delta = target - pseudoUtc(observed);
    if (delta === 0) return guess;
    guess += delta;
  }
  throw new Error(
    `local time ${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} ` +
      `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")} ` +
      `does not resolve in timezone ${timeZone}`,
  );
}

function parseMonthKey(monthKey: string): { year: number; month: number } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthKey);
  if (match === null) throw new Error(`invalid month key ${monthKey}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function parseDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(date);
  if (match === null) throw new Error(`invalid planned date ${date}`);
  const result = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const normalized = new Date(Date.UTC(result.year, result.month - 1, result.day));
  if (
    normalized.getUTCFullYear() !== result.year ||
    normalized.getUTCMonth() !== result.month - 1 ||
    normalized.getUTCDate() !== result.day
  ) {
    throw new Error(`planned date ${date} does not resolve`);
  }
  return result;
}

export const defaultTimelineCalendar: TimelineCalendar = {
  monthKeyForInstant(epochMs, timeZone) {
    const parts = partsAt(epochMs, timeZone);
    return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}`;
  },

  monthStartEpochMs(monthKey, timeZone) {
    const { year, month } = parseMonthKey(monthKey);
    return localDateTimeEpochMs({ year, month, day: 1, hour: 0, minute: 0, second: 0 }, timeZone);
  },

  nextMonthKey(monthKey) {
    const { year, month } = parseMonthKey(monthKey);
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
  },

  localNoonEpochMs(date, timeZone) {
    const { year, month, day } = parseDate(date);
    return localDateTimeEpochMs({ year, month, day, hour: 12, minute: 0, second: 0 }, timeZone);
  },

  formatMonth(monthKey) {
    const { year, month } = parseMonthKey(monthKey);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    })
      .format(new Date(Date.UTC(year, month - 1, 1)))
      .toUpperCase();
  },
};
