export function mergePage<T extends { id: string }>(current: T[], page: T[]) {
  const seen = new Set(current.map((x) => x.id));
  return [...current, ...page.filter((x) => !seen.has(x.id))];
}
