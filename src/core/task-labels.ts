// Display labels never rewrite the stored user request or call a model.
export function taskTitle(goal: string, max = 110) {
  const line = goal.trim().split(/\r?\n/, 1)[0].replace(/\s+/g, " ");
  return line.length > max ? line.slice(0, max - 1).trimEnd() + "…" : line;
}
