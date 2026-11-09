export function allowancePeriod(
  now = new Date(),
  accessUntil?: string | Date | null,
) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const end = new Date(
    Math.min(
      next.getTime(),
      accessUntil == null ? Infinity : new Date(accessUntil).getTime(),
    ),
  );
  return { key: start.toISOString().slice(0, 7), start, next, end };
}

export function allowanceSchedule(
  account: {
    subscription_status: string;
    access_expires_at?: string | Date | null;
    stripe_managed?: boolean;
    subscription_period_end?: string | Date | null;
    plan_active?: boolean;
    suspended?: boolean;
  },
  now = new Date(),
) {
  const active =
    account.subscription_status === "active" &&
    account.plan_active !== false &&
    !account.suspended &&
    (account.access_expires_at == null ||
      new Date(account.access_expires_at) > now);
  const window = allowancePeriod(now, account.access_expires_at);
  return {
    mode: account.stripe_managed ? "payment" : active ? "monthly" : "none",
    active,
    timezone: "UTC",
    next_at: !active
      ? null
      : account.stripe_managed
        ? (account.subscription_period_end ?? null)
        : account.access_expires_at == null ||
            window.next < new Date(account.access_expires_at)
          ? window.next.toISOString()
          : null,
    ends_at: account.access_expires_at ?? null,
  };
}
