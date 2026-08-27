// The ONLY write path for client master data.
//
// WHY EVERYTHING FUNNELS THROUGH HERE
// pms_clients_audit_log has the right shape and 6,386 rows, but there are NO
// TRIGGERS on pms_clients_master and no other application code writes to it —
// every existing row came from a January 2026 migration. Nothing is logged
// automatically. If a future caller updates the table directly, that change is
// invisible forever. So the audit insert lives in the same transaction as the
// update, and all mutations go through this module.
//
// WHY pool.connect() AND NOT query()
// lib/db.ts implements query() with pool.query(), which takes a DIFFERENT
// pooled connection per call. BEGIN/COMMIT issued through it would not be one
// transaction — the update could commit while the audit insert failed. A
// dedicated client is required.
import pool from "@/lib/db";
import type { AdminUser } from "@/lib/adminAuth";

/**
 * Fields an admin may change. Exhaustive and enforced server-side.
 *
 * Deliberately EXCLUDED: clientcode, clientid, pannumber, groupid. Those are
 * text join keys — pms_clients_master.intermediaryname matches a distributor's
 * clientname, and family membership is groupid equality. Renaming one silently
 * orphans dependent rows, as a previous distributor rename demonstrated.
 */
export const EDITABLE_FIELDS = [
  "head_of_family",
  "email",
  "mobile",
  "address1",
  "address2",
  "city",
  "state",
  "pincode",
  "onboarding_status",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

const EDITABLE_SET = new Set<string>(EDITABLE_FIELDS);

/** Columns captured in the audit snapshot, so a change is reconstructable. */
const SNAPSHOT_COLUMNS = `
  id, clientid, clientname, clientcode, email, mobile, address1, address2,
  city, state, pincode, groupid, groupname, head_of_family, onboarding_status`;

/** Normalises an incoming value: empty string becomes NULL, booleans coerced. */
function normalise(field: string, value: unknown): unknown {
  if (field === "head_of_family") {
    if (value === null || value === undefined) return null;
    return Boolean(value);
  }
  if (typeof value === "string") {
    const t = value.trim();
    return t === "" ? null : t;
  }
  return value ?? null;
}

/**
 * Applies an allowlisted patch to one client and records it in the audit log,
 * atomically. Returns the fields that actually changed — a no-op patch is a
 * success with an empty list, not an error.
 */
export async function updateClient(
  id: number,
  patch: Record<string, unknown>,
  admin: AdminUser,
): Promise<{ ok: true; changedFields: string[] } | { ok: false; error: string }> {
  const rejected = Object.keys(patch).filter((k) => !EDITABLE_SET.has(k));
  if (rejected.length) {
    return { ok: false, error: `Not editable: ${rejected.join(", ")}` };
  }
  if (!Object.keys(patch).length) {
    return { ok: false, error: "No fields supplied" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const before = await client.query(
      `SELECT ${SNAPSHOT_COLUMNS} FROM pms_clients_master WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const oldRow = before.rows?.[0];
    if (!oldRow) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Client not found" };
    }

    // Only fields whose value actually differs are written, so the audit log
    // records real changes rather than every save click.
    const changed: string[] = [];
    const sets: string[] = [];
    const params: any[] = [];
    for (const [field, raw] of Object.entries(patch)) {
      const value = normalise(field, raw);
      const current = oldRow[field] ?? null;
      if (String(current) === String(value ?? null)) continue;
      params.push(value);
      sets.push(`${field} = $${params.length}`);
      changed.push(field);
    }

    if (!changed.length) {
      await client.query("ROLLBACK");
      return { ok: true, changedFields: [] };
    }

    params.push(id);
    await client.query(
      `UPDATE pms_clients_master SET ${sets.join(", ")}, updated_at = now()
        WHERE id = $${params.length}`,
      params,
    );

    const after = await client.query(
      `SELECT ${SNAPSHOT_COLUMNS} FROM pms_clients_master WHERE id = $1`,
      [id],
    );

    await client.query(
      `INSERT INTO pms_clients_audit_log
         (operation_type, clientid, clientname, old_data, new_data,
          changed_fields, operation_timestamp, notes)
       VALUES ('UPDATE', $1, $2, $3, $4, $5, now(), $6)`,
      [
        oldRow.clientid,
        oldRow.clientname,
        JSON.stringify(oldRow),
        JSON.stringify(after.rows[0]),
        changed,
        `Edited in back office by ${admin.name} <${admin.email}>`,
      ],
    );

    await client.query("COMMIT");
    return { ok: true, changedFields: changed };
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("[adminClientMutations] updateClient failed:", err);
    return { ok: false, error: "Update failed" };
  } finally {
    client.release();
  }
}

/**
 * Makes one client the head of their family, clearing any existing head in the
 * same group.
 *
 * This is a FAMILY-level invariant — exactly one head per groupid — so it is
 * its own operation rather than a generic field edit. Clearing and setting
 * happen in one transaction, and each affected client gets its own audit row.
 * Production currently has zero families with more than one head; this keeps
 * that true.
 */
export async function setHeadOfFamily(
  groupid: string,
  clientId: number,
  admin: AdminUser,
): Promise<{ ok: true; cleared: number } | { ok: false; error: string }> {
  if (!groupid) return { ok: false, error: "Missing group" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const target = await client.query(
      `SELECT ${SNAPSHOT_COLUMNS} FROM pms_clients_master
        WHERE id = $1 AND groupid = $2 FOR UPDATE`,
      [clientId, groupid],
    );
    if (!target.rows?.length) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Client is not in this family" };
    }

    // Existing heads, so each can be audited individually.
    const previous = await client.query(
      `SELECT ${SNAPSHOT_COLUMNS} FROM pms_clients_master
        WHERE groupid = $1 AND head_of_family IS TRUE AND id <> $2 FOR UPDATE`,
      [groupid, clientId],
    );

    if (previous.rows.length) {
      await client.query(
        `UPDATE pms_clients_master SET head_of_family = false, updated_at = now()
          WHERE groupid = $1 AND head_of_family IS TRUE AND id <> $2`,
        [groupid, clientId],
      );
      for (const row of previous.rows) {
        await client.query(
          `INSERT INTO pms_clients_audit_log
             (operation_type, clientid, clientname, old_data, new_data,
              changed_fields, operation_timestamp, notes)
           VALUES ('UPDATE', $1, $2, $3, $4, $5, now(), $6)`,
          [
            row.clientid,
            row.clientname,
            JSON.stringify(row),
            JSON.stringify({ ...row, head_of_family: false }),
            ["head_of_family"],
            `Head of family reassigned by ${admin.name} <${admin.email}>`,
          ],
        );
      }
    }

    await client.query(
      `UPDATE pms_clients_master SET head_of_family = true, updated_at = now()
        WHERE id = $1`,
      [clientId],
    );

    const oldTarget = target.rows[0];
    await client.query(
      `INSERT INTO pms_clients_audit_log
         (operation_type, clientid, clientname, old_data, new_data,
          changed_fields, operation_timestamp, notes)
       VALUES ('UPDATE', $1, $2, $3, $4, $5, now(), $6)`,
      [
        oldTarget.clientid,
        oldTarget.clientname,
        JSON.stringify(oldTarget),
        JSON.stringify({ ...oldTarget, head_of_family: true }),
        ["head_of_family"],
        `Set as head of family by ${admin.name} <${admin.email}>`,
      ],
    );

    await client.query("COMMIT");
    return { ok: true, cleared: previous.rows.length };
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("[adminClientMutations] setHeadOfFamily failed:", err);
    return { ok: false, error: "Update failed" };
  } finally {
    client.release();
  }
}
