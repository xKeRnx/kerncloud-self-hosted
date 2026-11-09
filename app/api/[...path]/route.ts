import { NextRequest } from "next/server";
import { handle } from "@/src/server/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1860;
async function route(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return handle(req, (await params).path.join("/"));
}
export { route as GET, route as POST, route as PATCH, route as DELETE };
