export function accessExpired(
  account: { access_expires_at?: string | Date | null },
  now = Date.now(),
) {
  return (
    account.access_expires_at != null &&
    new Date(account.access_expires_at).getTime() <= now
  );
}
export const accessWindowSql =
  "(a.access_expires_at IS NULL OR a.access_expires_at>now())";
