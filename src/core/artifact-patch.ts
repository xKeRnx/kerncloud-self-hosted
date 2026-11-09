export function applyArtifactPatch(
  content: string,
  changes: { find: string; replace: string }[],
) {
  let updated = content;
  for (const change of changes) {
    const index = change.find ? updated.indexOf(change.find) : -1;
    if (index < 0 || index !== updated.lastIndexOf(change.find))
      throw new Error(
        "Jede zu ersetzende Stelle muss genau einmal in der aktuellen Datei vorkommen. Bitte den betreffenden Dateiausschnitt lesen.",
      );
    updated =
      updated.slice(0, index) +
      change.replace +
      updated.slice(index + change.find.length);
  }
  return updated;
}
