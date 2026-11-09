import { selfHostedEdition, selfHostedRouteAllowed } from "@/src/core/edition";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { ensureDb } from "@/src/server/db";
import { session, HttpError } from "@/src/server/auth";
import { preferredAppearance } from "@/src/server/appearance";
import { WorkspaceAppearance } from "@/components/workspace-appearance";
import type { ThemePreference } from "@/src/core/appearance";
import { notFound } from "next/navigation";
import { WorkspaceApp } from "@/components/workspace-app";
import { resolveWorkspacePath } from "@/src/core/navigation";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ section: string[] }>;
}) {
  const { section } = await params;
  if(selfHostedEdition && !selfHostedRouteAllowed(section.join("/"))) notFound();
  let theme: ThemePreference = "light", canSave = false;
  await ensureDb();
  try {
    const account = await session(new NextRequest("http://localhost/", {headers: await headers()}));
    theme = (await preferredAppearance(account.user.id)).theme;
    canSave = !account.support;
  } catch (error) {
    if (!(error instanceof HttpError) || ![401,403].includes(error.status)) throw error;
  }
  if (
    section.length === 1 &&
    (section[0] === "login" || section[0] === "signup")
  )
    return <WorkspaceAppearance initialTheme={theme} initialCanSave={canSave}><WorkspaceApp authMode={section[0]} /></WorkspaceAppearance>;
  if (!resolveWorkspacePath(`/${section.join("/")}`)) notFound();
  return <WorkspaceAppearance initialTheme={theme} initialCanSave={canSave}><WorkspaceApp /></WorkspaceAppearance>;
}
