import test from "node:test";
import assert from "node:assert/strict";
import {
  allowancePeriod,
  allowanceSchedule,
} from "../src/core/allowance-period.ts";
test("Monthly allowance boundaries use UTC, including leap years and year changes", () => {
  assert.equal(
    allowancePeriod(new Date("2028-02-29T23:59:59Z")).next.toISOString(),
    "2028-03-01T00:00:00.000Z",
  );
  assert.equal(
    allowancePeriod(new Date("2026-12-31T23:59:59Z")).next.toISOString(),
    "2027-01-01T00:00:00.000Z",
  );
  assert.equal(
    allowancePeriod(new Date("2026-10-31T23:30:00-02:00")).key,
    "2026-11",
  );
  const gift = allowancePeriod(
    new Date("2026-10-20T00:00:00Z"),
    "2026-10-25T10:00:00Z",
  );
  assert.equal(gift.end.toISOString(), "2026-10-25T10:00:00.000Z");
});
test("Renewal display never promises another grant at or after access expiry", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  assert.equal(
    allowanceSchedule(
      {
        subscription_status: "active",
        access_expires_at: "2026-11-01T00:00:00Z",
      },
      now,
    ).next_at,
    null,
  );
  assert.equal(
    allowanceSchedule(
      {
        subscription_status: "active",
        access_expires_at: "2026-11-15T00:00:00Z",
      },
      now,
    ).next_at,
    "2026-11-01T00:00:00.000Z",
  );
  for (const status of ["canceled", "free", "past_due", "local_test"]) {
    assert.equal(
      allowanceSchedule({ subscription_status: status }, now).active,
      false,
    );
  }
  assert.equal(
    allowanceSchedule(
      { subscription_status: "active", access_expires_at: now },
      now,
    ).active,
    false,
  );
  assert.equal(
    allowanceSchedule({ subscription_status: "active", suspended: true }, now)
      .active,
    false,
  );
  assert.equal(
    allowanceSchedule(
      { subscription_status: "active", stripe_managed: true },
      now,
    ).mode,
    "payment",
  );
});
