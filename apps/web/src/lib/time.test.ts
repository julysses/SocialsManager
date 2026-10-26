import { describe, expect, it } from "vitest";
import { utcToZonedInput, zonedToUtc } from "./time";

describe("zonedToUtc", () => {
  it("handles standard time (CST, UTC-6)", () => {
    expect(zonedToUtc("2026-11-02T14:00", "America/Chicago").toISOString()).toBe("2026-11-02T20:00:00.000Z");
  });
  it("handles daylight time (CDT, UTC-5)", () => {
    expect(zonedToUtc("2026-07-01T09:00", "America/Chicago").toISOString()).toBe("2026-07-01T14:00:00.000Z");
  });
  it("round-trips through the input format", () => {
    const d = zonedToUtc("2026-07-01T09:30", "America/Chicago");
    expect(utcToZonedInput(d, "America/Chicago")).toBe("2026-07-01T09:30");
  });
});
