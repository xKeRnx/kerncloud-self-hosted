import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction, audit } from "./db.ts";
import { hashToken } from "./security.ts";
import { HttpError } from "./auth.ts";
import { queueMail } from "./mail.ts";
import type { WorkspaceRole } from "../core/workspace-permissions.ts";
const role = z.enum(["admin", "editor", "viewer"]);
export async function workspaceRole(
  user: string,
  workspace: string,
): Promise<WorkspaceRole> {
  const row = (
    await pool.query(
      "SELECT CASE WHEN w.owner_id=$1 THEN 'owner' ELSE m.role END role FROM workspaces w LEFT JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=$1 WHERE w.id=$2",
      [user, workspace],
    )
  ).rows[0];
  if (!row?.role)
    throw new HttpError(403, "Kein Zugriff auf diesen Workspace.");
  return row.role;
}
export async function manageTeam(
  user: string,
  workspace: string,
  body?: unknown,
) {
  const access = await workspaceRole(user, workspace);
  if (!body) {
    return {
      role: access,
      members: (
        await pool.query(
          "SELECT u.id,u.name,u.email,CASE WHEN u.id=w.owner_id THEN 'owner' ELSE m.role END role FROM workspaces w JOIN users u ON u.id=w.owner_id OR EXISTS(SELECT 1 FROM workspace_members mm WHERE mm.workspace_id=w.id AND mm.user_id=u.id) LEFT JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=u.id WHERE w.id=$1 ORDER BY u.name",
          [workspace],
        )
      ).rows,
      invitations: ["owner", "admin"].includes(access)
        ? (
            await pool.query(
              "SELECT id,email,role,expires_at,accepted_at,revoked_at FROM workspace_invitations WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100",
              [workspace],
            )
          ).rows
        : [],
    };
  }
  const action = z
    .object({ action: z.enum(["invite", "role", "remove", "revoke", "leave"]) })
    .parse(body).action;
  if (action === "leave") {
    if (access === "owner")
      throw new HttpError(
        400,
        "Eigentümer können den eigenen Workspace nicht verlassen.",
      );
    await pool.query(
      "DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
      [workspace, user],
    );
    return { ok: true };
  }
  if (!["owner", "admin"].includes(access))
    throw new HttpError(
      403,
      "Nur Workspace-Administratoren verwalten Mitglieder.",
    );
  return transaction(async (c) => {
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      workspace,
    ]);
    // Recheck after lock: role revocation must fence queued administrative changes.
    const current = (
      await c.query(
        "SELECT CASE WHEN owner_id=$1 THEN 'owner' ELSE (SELECT role FROM workspace_members WHERE workspace_id=$2 AND user_id=$1) END role FROM workspaces WHERE id=$2",
        [user, workspace],
      )
    ).rows[0]?.role;
    if (!["owner", "admin"].includes(current))
      throw new HttpError(403, "Teamrecht wurde entzogen.");
    if (action === "invite") {
      const b = z
          .object({ email: z.string().email().max(254), role })
          .parse(body),
        email = b.email.toLowerCase();
      const count = (
        await c.query(
          "SELECT (SELECT count(*) FROM workspace_members WHERE workspace_id=$1)+(SELECT count(*) FROM workspace_invitations WHERE workspace_id=$1 AND expires_at>now() AND accepted_at IS NULL AND revoked_at IS NULL) n",
          [workspace],
        )
      ).rows[0];
      if (Number(count.n) >= 50)
        throw new HttpError(
          409,
          "Maximal 50 Mitglieder und offene Einladungen.",
        );
      await c.query(
        "UPDATE workspace_invitations SET revoked_at=now() WHERE workspace_id=$1 AND email=$2 AND accepted_at IS NULL",
        [workspace, email],
      );
      const id = randomUUID(),
        token = randomBytes(32).toString("base64url"),
        expires = new Date(Date.now() + 7 * 86400000);
      await c.query(
        "INSERT INTO workspace_invitations(id,workspace_id,email,role,token_hash,invited_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [id, workspace, email, b.role, hashToken(token), user, expires],
      );
      const link =
        (process.env.PUBLIC_URL ?? "http://localhost:3100") +
        "/team?invite=" +
        encodeURIComponent(token);
      await queueMail(
        c,
        null,
        email,
        "workspace_invite",
        "Invitation to KeRnCloud",
        `You have been invited as ${b.role}. Sign in with ${email} and open this link within seven days: ${link}`,
        expires,
      );
      await audit(c, user, "workspace.member.invite", id);
      return { ok: true, invite_url: link };
    }
    const b = z
      .object({ id: z.string().uuid(), role: role.optional() })
      .parse(body);
    if (action === "revoke") {
      await c.query(
        "UPDATE workspace_invitations SET revoked_at=now() WHERE id=$1 AND workspace_id=$2",
        [b.id, workspace],
      );
    } else {
      const owner = (
        await c.query("SELECT owner_id FROM workspaces WHERE id=$1", [
          workspace,
        ])
      ).rows[0].owner_id;
      if (owner === b.id)
        throw new HttpError(403, "Eigentümerrolle ist geschützt.");
      if (action === "role") {
        if (!b.role) throw new HttpError(400, "Rolle fehlt.");
        await c.query(
          "UPDATE workspace_members SET role=$3 WHERE workspace_id=$1 AND user_id=$2",
          [workspace, b.id, b.role],
        );
      } else
        await c.query(
          "DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
          [workspace, b.id],
        );
    }
    await audit(c, user, "workspace.member." + action, b.id);
    return { ok: true };
  });
}
export async function acceptTeamInvite(
  user: string,
  email: string,
  body: unknown,
) {
  const { token } = z
    .object({ token: z.string().min(40).max(200) })
    .parse(body);
  return transaction(async (c) => {
    const ref = (
      await c.query(
        "SELECT workspace_id FROM workspace_invitations WHERE token_hash=$1",
        [hashToken(token)],
      )
    ).rows[0];
    if (!ref) throw new HttpError(403, "Einladung ungültig.");
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      ref.workspace_id,
    ]);
    const invite = (
      await c.query(
        "SELECT * FROM workspace_invitations WHERE token_hash=$1 FOR UPDATE",
        [hashToken(token)],
      )
    ).rows[0];
    if (
      !invite ||
      invite.revoked_at ||
      invite.accepted_at ||
      Date.parse(invite.expires_at) <= Date.now() ||
      invite.email !== email.toLowerCase()
    )
      throw new HttpError(
        403,
        "Einladung ungültig, abgelaufen oder für eine andere E-Mail-Adresse.",
      );
    const owner = (
      await c.query("SELECT owner_id FROM workspaces WHERE id=$1 FOR UPDATE", [
        invite.workspace_id,
      ])
    ).rows[0];
    if (!owner) throw new HttpError(404, "Workspace fehlt.");
    if (owner.owner_id === user)
      throw new HttpError(400, "Du bist bereits Eigentümer.");
    await c.query(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role",
      [invite.workspace_id, user, invite.role],
    );
    await c.query(
      "UPDATE workspace_invitations SET accepted_at=now(),accepted_by=$2 WHERE id=$1",
      [invite.id, user],
    );
    await audit(c, user, "workspace.member.accept", invite.id);
    return { ok: true, workspace_id: invite.workspace_id };
  });
}
