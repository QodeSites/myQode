"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type ClientRow = {
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

type ClientDetail = ClientRow & {
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

type AuditEntry = {
  id: number;
  operationType: string;
  changedFields: string[] | null;
  operationTimestamp: string;
  notes: string | null;
};

type InvestorProfile = {
  zohoId: string;
  name: string | null;
  mobile: string | null;
  stage: string | null;
  investorSource: string | null;
  activationDate: string | null;
  accountLiveDate: string | null;
  firstTopUpDate: string | null;
  investedAmount: number | null;
  currentValue: number | null;
  expectedAum: number | null;
  strategies: string[];
  feesStructure: string[];
  occupation: string | null;
  city: string | null;
  country: string | null;
  riskAppetite: string | null;
  relationshipManager: string | null;
  lastConversation: string | null;
  lastContactedOn: string | null;
  nextContactDate: string | null;
  annualReviewStatus: string | null;
  annualReviewDate: string | null;
  hadWalkthrough: boolean;
  walkthroughDate: string | null;
  referredBy: string | null;
};

type DetailResponse = {
  client: ClientDetail;
  family: ClientRow[];
  audit: AuditEntry[];
  /** Null when the investor has no CRM record, or Zoho was unreachable. */
  zoho: InvestorProfile | null;
};

/** The fields this page may edit. Mirrors EDITABLE_FIELDS server-side, which
 *  is the actual enforcement — this list only shapes the form. */
const TEXT_FIELDS = [
  { key: "email", label: "Email", type: "email" },
  { key: "mobile", label: "Mobile", type: "tel" },
  { key: "address1", label: "Address line 1", type: "text" },
  { key: "address2", label: "Address line 2", type: "text" },
  { key: "city", label: "City", type: "text" },
  { key: "state", label: "State", type: "text" },
  { key: "pincode", label: "Pincode", type: "text" },
] as const;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(iso)}, ${d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** Indian grouping, crore/lakh shorthand above a lakh. */
function money(n: number | null): string {
  if (n == null) return "—";
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function ReadOnlyField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-all text-sm text-foreground">{value ?? "—"}</dd>
    </div>
  );
}

export default function AdminClientDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [data, setData] = React.useState<DetailResponse | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "unauthorized" | "error">(
    "loading",
  );
  const [form, setForm] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "ok" | "bad"; text: string } | null>(
    null,
  );

  const load = React.useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/admin/clients/${id}`, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setStatus("unauthorized");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const body = (await res.json()) as DetailResponse;
      setData(body);
      setForm({
        email: body.client.email ?? "",
        mobile: body.client.mobile ?? "",
        address1: body.client.address1 ?? "",
        address2: body.client.address2 ?? "",
        city: body.client.city ?? "",
        state: body.client.state ?? "",
        pincode: body.client.pincode ?? "",
        onboarding_status: body.client.onboardingStatus ?? "",
      });
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Only fields that actually differ are sent, so the audit log records real
  // changes rather than every save click.
  const changedPatch = React.useMemo(() => {
    if (!data) return {} as Record<string, string>;
    const original: Record<string, string> = {
      email: data.client.email ?? "",
      mobile: data.client.mobile ?? "",
      address1: data.client.address1 ?? "",
      address2: data.client.address2 ?? "",
      city: data.client.city ?? "",
      state: data.client.state ?? "",
      pincode: data.client.pincode ?? "",
      onboarding_status: data.client.onboardingStatus ?? "",
    };
    const patch: Record<string, string> = {};
    for (const [k, v] of Object.entries(form)) {
      if ((original[k] ?? "") !== v) patch[k] = v;
    }
    return patch;
  }, [data, form]);

  const hasChanges = Object.keys(changedPatch).length > 0;

  async function save() {
    if (!id || !hasChanges) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changedPatch),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage({ tone: "bad", text: body?.error ?? "Couldn't save those changes." });
        return;
      }
      const n = body?.changedFields?.length ?? 0;
      setMessage(
        n === 0
          ? { tone: "ok", text: "No changes to save." }
          : { tone: "ok", text: `Saved — ${n} field${n === 1 ? "" : "s"} updated.` },
      );
      await load();
    } catch {
      setMessage({ tone: "bad", text: "Couldn't reach the server. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  async function makeHead(clientId: number) {
    if (!data?.client.groupid) return;
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/families/${encodeURIComponent(data.client.groupid)}/head`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        setMessage({ tone: "bad", text: body?.error ?? "Couldn't set head of family." });
        return;
      }
      setMessage({ tone: "ok", text: "Head of family updated." });
      await load();
    } catch {
      setMessage({ tone: "bad", text: "Couldn't reach the server. Please try again." });
    }
  }

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (status === "unauthorized") {
    return (
      <div className="rounded-xl border border-border/20 bg-card shadow-sm px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Your session has expired.{" "}
          <a
            className="font-bold text-primary underline underline-offset-4 dark:text-primary-foreground"
            href={`/admin/login?redirect=/admin/clients/${id}`}
          >
            Sign in again
          </a>{" "}
          to continue.
        </p>
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
        <p className="text-sm text-foreground">
          We couldn&apos;t load this client. They may have been removed — go back to{" "}
          <Link href="/admin/clients" className="font-bold underline underline-offset-4">
            all clients
          </Link>
          .
        </p>
      </div>
    );
  }

  const c = data.client;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/admin/clients"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All clients
        </Link>
        <h1 className="mt-2 text-2xl">{c.clientname ?? "Client"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {c.clientcode ?? "—"}
          {c.headOfFamily ? (
            <span className="ml-2 inline-block rounded-full border border-border/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary dark:text-primary-foreground">
              Head of family
            </span>
          ) : null}
        </p>
      </div>

      {message ? (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            message.tone === "ok"
              ? "border-border/20 bg-card text-foreground"
              : "border-destructive/30 bg-destructive/5 text-foreground"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {/* Identity — read-only, with the reason stated rather than implied. */}
      <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
        <div className="flex items-center gap-2">
          <Lock className="size-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">Identity</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          These identifiers link this client to their family and distributor and cannot
          be edited here.
        </p>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <ReadOnlyField label="Client code" value={c.clientcode} />
          <ReadOnlyField label="Client ID" value={c.clientid} />
          <ReadOnlyField label="PAN" value={c.pannumber} />
          <ReadOnlyField label="Group ID" value={c.groupid} />
          <ReadOnlyField label="Family" value={c.groupname} />
          <ReadOnlyField label="Scheme" value={c.schemename} />
          <ReadOnlyField label="Distributor" value={c.intermediaryname} />
          <ReadOnlyField label="Account opened" value={formatDate(c.accountOpenDate)} />
        </dl>
      </section>

      {/* Editable details */}
      <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
        <h2 className="text-lg font-semibold text-foreground">Contact &amp; status</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Changes are recorded against your name in the history below.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TEXT_FIELDS.map((f) => (
            <div key={f.key}>
              <label
                htmlFor={f.key}
                className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
              >
                {f.label}
              </label>
              <input
                id={f.key}
                type={f.type}
                value={form[f.key] ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                className="mt-1 min-h-[44px] w-full rounded-md border border-border/20 bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary"
              />
            </div>
          ))}

          <div>
            <label
              htmlFor="onboarding_status"
              className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
            >
              Onboarding status
            </label>
            <select
              id="onboarding_status"
              value={form.onboarding_status ?? ""}
              onChange={(e) =>
                setForm((s) => ({ ...s, onboarding_status: e.target.value }))
              }
              className="mt-1 min-h-[44px] w-full rounded-md border border-border/20 bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            >
              <option value="">—</option>
              <option value="pending">pending</option>
              <option value="completed">completed</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={!hasChanges || saving}
          className="mt-5 min-h-[44px] rounded-md border border-border/20 bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </section>

      {/* CRM profile */}
      {data.zoho ? (
        <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-foreground">
              CRM profile
            </h2>
            <p className="text-xs text-muted-foreground">
              From Zoho · read-only here
            </p>
          </div>

          {/* Money first — it is what most questions are really about. */}
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-md border border-border/20 bg-background px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
                Invested
              </p>
              <p className="mt-1 font-sans text-xl font-bold tabular-nums text-foreground">
                {money(data.zoho.investedAmount)}
              </p>
            </div>
            <div className="rounded-md border border-border/20 bg-background px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
                Current value
              </p>
              <p className="mt-1 font-sans text-xl font-bold tabular-nums text-foreground">
                {money(data.zoho.currentValue)}
              </p>
            </div>
            <div className="rounded-md border border-border/20 bg-background px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
                Gain
              </p>
              {(() => {
                const inv = data.zoho.investedAmount;
                const cur = data.zoho.currentValue;
                if (inv == null || cur == null || inv === 0) {
                  return (
                    <p className="mt-1 font-sans text-xl font-bold tabular-nums text-muted-foreground">
                      —
                    </p>
                  );
                }
                const delta = cur - inv;
                const up = delta >= 0;
                return (
                  <p
                    className={`mt-1 font-sans text-xl font-bold tabular-nums ${
                      up ? "text-[#008455]" : "text-destructive"
                    }`}
                  >
                    {up ? "+" : "−"}
                    {money(Math.abs(delta)).replace("₹", "₹")}
                    <span className="ml-1.5 text-[11px] font-normal">
                      {up ? "+" : "−"}
                      {Math.abs(Math.round((delta / inv) * 100))}%
                    </span>
                  </p>
                );
              })()}
            </div>
            <div className="rounded-md border border-border/20 bg-background px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
                Stage
              </p>
              <p
                className={`mt-1 text-sm font-bold ${
                  data.zoho.stage?.startsWith("Dropped")
                    ? "text-destructive"
                    : "text-foreground"
                }`}
              >
                {data.zoho.stage ?? "—"}
              </p>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-border/20 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <ReadOnlyField
              label="Strategies"
              value={data.zoho.strategies.join(", ") || null}
            />
            <ReadOnlyField
              label="Fee structure"
              value={data.zoho.feesStructure.join(", ") || null}
            />
            <ReadOnlyField
              label="Relationship manager"
              value={data.zoho.relationshipManager}
            />
            <ReadOnlyField label="Source" value={data.zoho.investorSource} />
            <ReadOnlyField label="Occupation" value={data.zoho.occupation} />
            <ReadOnlyField
              label="Location"
              value={
                [data.zoho.city, data.zoho.country].filter(Boolean).join(", ") || null
              }
            />
            <ReadOnlyField label="Mobile" value={data.zoho.mobile} />
            <ReadOnlyField label="Risk appetite" value={data.zoho.riskAppetite} />
            <ReadOnlyField
              label="Activated"
              value={formatDate(data.zoho.activationDate)}
            />
            <ReadOnlyField
              label="Account live"
              value={formatDate(data.zoho.accountLiveDate)}
            />
            <ReadOnlyField
              label="First top-up"
              value={formatDate(data.zoho.firstTopUpDate)}
            />
            <ReadOnlyField
              label="Referred by"
              value={data.zoho.referredBy}
            />
          </dl>

          {/* Relationship state — the part someone picking up this client needs. */}
          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border/20 pt-4 lg:grid-cols-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
                Annual review
              </p>
              <p
                className={`mt-0.5 text-sm ${
                  data.zoho.annualReviewStatus === "Not Done"
                    ? "font-bold text-destructive"
                    : "text-foreground"
                }`}
              >
                {data.zoho.annualReviewStatus ?? "—"}
                {data.zoho.annualReviewDate
                  ? ` · due ${formatDate(data.zoho.annualReviewDate)}`
                  : ""}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
                Portal walkthrough
              </p>
              <p className="mt-0.5 text-sm text-foreground">
                {data.zoho.hadWalkthrough
                  ? `Done${data.zoho.walkthroughDate ? ` · ${formatDate(data.zoho.walkthroughDate)}` : ""}`
                  : "Not done"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
                Next contact
              </p>
              <p className="mt-0.5 text-sm text-foreground">
                {formatDate(data.zoho.nextContactDate)}
                {data.zoho.lastContactedOn
                  ? ` · last ${formatDate(data.zoho.lastContactedOn)}`
                  : ""}
              </p>
            </div>
          </div>

          {data.zoho.lastConversation ? (
            <div className="mt-4 rounded-md border border-border/20 bg-background px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.11em] text-muted-foreground">
                Last conversation
              </p>
              <p className="mt-1 text-sm leading-relaxed text-foreground">
                {data.zoho.lastConversation}
              </p>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
          <h2 className="text-lg font-semibold text-foreground">CRM profile</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            No Zoho record matches this client&apos;s email address. Their portal
            details above are unaffected.
          </p>
        </section>
      )}

      {/* Family */}
      <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
        <h2 className="text-lg font-semibold text-foreground">Family</h2>
        {!c.groupid ? (
          <p className="mt-3 text-sm text-muted-foreground">
            This client is not part of a family group.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              {c.groupname ?? "Family"} · {data.family.length}{" "}
              {data.family.length === 1 ? "account" : "accounts"}
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border/20 text-left">
                    {["Name", "Client code", "Status", ""].map((h, i) => (
                      <th
                        key={i}
                        className="py-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground last:pr-0"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.family.map((m) => (
                    <tr key={m.id} className="border-b border-border/10 last:border-0">
                      <td className="py-2.5 pr-4">
                        <Link
                          href={`/admin/clients/${m.id}`}
                          className="text-foreground underline-offset-4 hover:underline"
                        >
                          {m.clientname ?? "—"}
                        </Link>
                        {m.headOfFamily ? (
                          <span className="ml-2 inline-block rounded-full border border-border/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary dark:text-primary-foreground">
                            Head
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">
                        {m.clientcode ?? "—"}
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        {m.onboardingStatus ?? "—"}
                      </td>
                      <td className="py-2.5 text-right">
                        {m.headOfFamily ? null : (
                          <button
                            type="button"
                            onClick={() => makeHead(m.id)}
                            className="min-h-[36px] rounded-md border border-border/20 bg-background px-3 text-xs font-bold text-primary hover:bg-primary hover:text-primary-foreground dark:text-primary-foreground"
                          >
                            Set as head
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Audit trail */}
      <section className="rounded-xl border border-border/20 bg-card shadow-sm px-5 py-5">
        <h2 className="text-lg font-semibold text-foreground">Recent changes</h2>
        {data.audit.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No recorded changes for this client.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {data.audit.map((a) => (
              <li
                key={a.id}
                className="border-b border-border/10 pb-3 last:border-0 last:pb-0"
              >
                <p className="text-sm text-foreground">
                  {a.changedFields?.length
                    ? a.changedFields.join(", ")
                    : a.operationType}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDateTime(a.operationTimestamp)}
                  {a.notes ? ` · ${a.notes}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
