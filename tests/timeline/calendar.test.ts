import { describe, expect, it } from "vitest";

import { defaultTimelineCalendar } from "../../src/timeline";

describe("timeline calendar", () => {
  it("resolves project-local month boundaries and noon across DST", () => {
    expect(
      new Date(defaultTimelineCalendar.monthStartEpochMs("2026-04", "Europe/Paris")).toISOString(),
    ).toBe("2026-03-31T22:00:00.000Z");
    expect(
      new Date(defaultTimelineCalendar.localNoonEpochMs("2026-05-05", "Europe/Paris")).toISOString(),
    ).toBe("2026-05-05T10:00:00.000Z");
    expect(
      defaultTimelineCalendar.monthKeyForInstant(
        Date.parse("2026-05-01T00:15:00+02:00"),
        "Europe/Paris",
      ),
    ).toBe("2026-05");
  });

  it("increments year boundaries and formats deterministic labels", () => {
    expect(defaultTimelineCalendar.nextMonthKey("2026-12")).toBe("2027-01");
    expect(defaultTimelineCalendar.formatMonth("2027-01")).toBe("JANUARY 2027");
  });

  it("rejects impossible local dates instead of normalizing them silently", () => {
    expect(() =>
      defaultTimelineCalendar.localNoonEpochMs("2026-02-31", "Europe/Paris"),
    ).toThrow(/does not resolve/);
  });
});
