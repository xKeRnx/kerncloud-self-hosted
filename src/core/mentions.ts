export function mentionedAgents(
  message: string,
  agents: { id: string; name: string }[],
) {
  const tags = [...message.matchAll(/@([\p{L}\p{N}_-]+)/gu)].map((m) =>
    m[1].toLocaleLowerCase("de"),
  );
  if (tags.includes("alle")) return agents.map((a) => a.id);
  const ids: string[] = [];
  for (const tag of tags) {
    const matches = agents.filter(
      (a) => a.name.replace(/\s+/g, "_").toLocaleLowerCase("de") === tag,
    );
    if (matches.length > 1)
      throw new Error(
        `@${tag} ist nicht eindeutig. Bitte Agenten unterschiedlich benennen.`,
      );
    if (matches.length) ids.push(matches[0].id);
  }
  return [...new Set(ids)];
}
