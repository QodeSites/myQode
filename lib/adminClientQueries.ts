// Read-side queries for the admin back office.
//
// Distributors are excluded from every client query: pms_clients_master holds
// both, and a distributor row is identified by clientcode IS NULL (verified:
// 17 of 555 rows). They are managed at /distributors/internal, not here.
import { query } from "@/lib/db";

export type ClientListRow = {
  id: number;
  clientid: string | null;
  clientname: string | null;
  clientcode: string | null;
  email: string | null;
  mobile: string | null;
  groupid: string | null;
  groupname: string | null;
  headOfFamily: boolean | null;
  onboardingStatus: string | null;
  lastLoginAt: string | null;
};

export type ClientDetail = ClientListRow & {
  pannumber: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  schemename: string | null;
  intermediaryname: string | null;
  accountOpenDate: string | null;
};

export type AuditEntry = {
  id: number;
  operationType: string;
  changedFields: string[] | null;
  operationTimestamp: string;
  notes: string | null;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
};

export type FamilyGroup = {
  groupid: string;
  groupname: string | null;
  memberCount: number;
  headCount: number;
  members: ClientListRow[];
};

const LIST_COLUMNS = `
  id, clientid, clientname, clientcode, email, mobile,
  groupid, groupname, head_of_family, onboarding_status, last_login_at`;

function mapListRow(r: any): ClientListRow {
  return {
    id: Number(r.id),
    clientid: r.clientid ?? null,
    clientname: r.clientname ?? null,
    clientcode: r.clientcode ?? null,
    email: r.email ?? null,
    mobile: r.mobile ?? null,
    groupid: r.groupid ?? null,
    groupname: r.groupname ?? null,
    headOfFamily: r.head_of_family ?? null,
    onboardingStatus: r.onboarding_status ?? null,
    lastLoginAt: r.last_login_at ? String(r.last_login_at) : null,
  };
}

/** Paged client search. Distributor rows (clientcode IS NULL) are excluded. */
export async function searchClients(opts: {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: ClientListRow[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  const params: any[] = [];
  const where: string[] = ["clientcode IS NOT NULL"];

  if (opts.q?.trim()) {
    params.push(`%${opts.q.trim()}%`);
    const i = params.length;
    where.push(
      `(clientname ILIKE $${i} OR email ILIKE $${i} OR clientcode ILIKE $${i}
        OR mobile ILIKE $${i} OR groupname ILIKE $${i})`,
    );
  }

  if (opts.status?.trim()) {
    params.push(opts.status.trim());
    where.push(`onboarding_status = $${params.length}`);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;

  const countRes = await query(
    `SELECT count(*)::int AS n FROM pms_clients_master ${whereSql}`,
    params,
  );

  params.push(pageSize, (page - 1) * pageSize);
  const rowsRes = await query(
    `SELECT ${LIST_COLUMNS} FROM pms_clients_master ${whereSql}
      ORDER BY clientname NULLS LAST, clientcode
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return {
    rows: (rowsRes.rows ?? []).map(mapListRow),
    total: Number(countRes.rows?.[0]?.n ?? 0),
  };
}

/** One client by primary key, or null. */
export async function getClientDetail(id: number): Promise<ClientDetail | null> {
  const res = await query(
    `SELECT ${LIST_COLUMNS}, pannumber, address1, address2, city, state,
            pincode, schemename, intermediaryname, account_open_date
       FROM pms_clients_master WHERE id = $1 LIMIT 1`,
    [id],
  );
  const r = res.rows?.[0];
  if (!r) return null;
  return {
    ...mapListRow(r),
    pannumber: r.pannumber ?? null,
    address1: r.address1 ?? null,
    address2: r.address2 ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
    pincode: r.pincode ?? null,
    schemename: r.schemename ?? null,
    intermediaryname: r.intermediaryname ?? null,
    accountOpenDate: r.account_open_date ? String(r.account_open_date) : null,
  };
}

/** Every account in a family group, including the caller's own row. */
export async function getFamilyMembers(groupid: string): Promise<ClientListRow[]> {
  if (!groupid) return [];
  const res = await query(
    `SELECT ${LIST_COLUMNS} FROM pms_clients_master
      WHERE groupid = $1 ORDER BY clientcode`,
    [groupid],
  );
  return (res.rows ?? []).map(mapListRow);
}

/** Recent audit entries for one client, newest first. */
export async function getClientAudit(
  clientid: string,
  limit = 20,
): Promise<AuditEntry[]> {
  if (!clientid) return [];
  const res = await query(
    `SELECT id, operation_type, changed_fields, operation_timestamp,
            notes, old_data, new_data
       FROM pms_clients_audit_log
      WHERE clientid = $1
      ORDER BY operation_timestamp DESC
      LIMIT $2`,
    [clientid, Math.min(100, Math.max(1, limit))],
  );
  return (res.rows ?? []).map((r: any) => ({
    id: Number(r.id),
    operationType: String(r.operation_type),
    changedFields: r.changed_fields ?? null,
    operationTimestamp: String(r.operation_timestamp),
    notes: r.notes ?? null,
    oldData: r.old_data ?? null,
    newData: r.new_data ?? null,
  }));
}

/**
 * Family groups with their members.
 *
 * `missingHeadOnly` returns multi-account families where no member is head —
 * 181 of 196 such families as of 2026-08-27. That is the back office's
 * day-one job, so it gets a first-class query rather than client-side
 * filtering.
 */
export async function getFamilyGroups(opts: {
  missingHeadOnly?: boolean;
}): Promise<FamilyGroup[]> {
  const having = opts.missingHeadOnly
    ? `HAVING count(*) > 1 AND count(*) FILTER (WHERE head_of_family) = 0`
    : `HAVING count(*) > 1`;

  const groupsRes = await query(
    `SELECT groupid, max(groupname) AS groupname,
            count(*)::int AS member_count,
            count(*) FILTER (WHERE head_of_family)::int AS head_count
       FROM pms_clients_master
      WHERE groupid IS NOT NULL AND clientcode IS NOT NULL
      GROUP BY groupid ${having}
      ORDER BY count(*) DESC, max(groupname)`,
  );

  const groups = groupsRes.rows ?? [];
  if (!groups.length) return [];

  const ids = groups.map((g: any) => g.groupid);
  const membersRes = await query(
    `SELECT ${LIST_COLUMNS} FROM pms_clients_master
      WHERE groupid = ANY($1) ORDER BY clientcode`,
    [ids],
  );

  const byGroup = new Map<string, ClientListRow[]>();
  for (const r of membersRes.rows ?? []) {
    const key = String(r.groupid);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(mapListRow(r));
  }

  return groups.map((g: any) => ({
    groupid: String(g.groupid),
    groupname: g.groupname ?? null,
    memberCount: Number(g.member_count),
    headCount: Number(g.head_count),
    members: byGroup.get(String(g.groupid)) ?? [],
  }));
}
