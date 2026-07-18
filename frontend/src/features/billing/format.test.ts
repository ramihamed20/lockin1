import { describe, expect, it } from "vitest";

import { formatDate, formatMoney } from "./format";

describe("billing formatters", () => {
  it("respects authoritative currency exponents", () => {
    expect(formatMoney(1_234, "JPY", 0, "en")).toContain("1,234");
    expect(formatMoney(1_234, "BHD", 3, "en")).toContain("1.234");
  });

  it("formats server timestamps for the active locale", () => {
    expect(formatDate("2026-07-18T00:00:00Z", "en")).toContain("2026");
  });
});
