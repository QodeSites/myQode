// POST /api/distributor/ticket
// Lets a distribution partner raise a ticket with the Qode team.
//
// Tickets land in the same queue as investor queries
// (pms_clients_tracker.qode_microsite_inquiries, surfaced at /admin/queries)
// so the team works one list rather than remembering a second inbox.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveDistributorByEmail } from "@/lib/distributorIdentity";
import { query } from "@/lib/db1";
import { graphMailer as resend } from "@/lib/graphEmail";

const PARTNERSHIPS = "partnerships@qodeinvest.com";

/** Subject lines a partner can pick. Free text goes in the body. */
const TOPICS: Record<string, string> = {
  onboarding: "Onboarding help",
  investor: "Question about an investor",
  payout: "Payout or brokerage",
  reporting: "Reporting or statements",
  access: "Portal access",
  other: "Other",
};

const MAX_MESSAGE = 4000;

/** Escapes user text for HTML email. The message is partner-supplied. */
function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get("qode-user-context")?.value;
    if (!raw) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    let email: string | undefined;
    try {
      email = JSON.parse(raw)?.email;
    } catch {
      return NextResponse.json({ error: "Invalid session" }, { status: 400 });
    }

    // Same boundary as every other distributor route: the identity lookup IS
    // the role check. Note the sender is taken from the session, never from
    // the body — a partner cannot raise a ticket as somebody else.
    const distributor = await resolveDistributorByEmail(email);
    if (!distributor) {
      return NextResponse.json({ error: "Not a distributor" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const topicKey = String(body?.topic ?? "").trim();
    const message = String(body?.message ?? "").trim();
    const aboutInvestor = String(body?.aboutInvestor ?? "").trim();

    if (!TOPICS[topicKey]) {
      return NextResponse.json({ error: "Pick a topic" }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }
    if (message.length > MAX_MESSAGE) {
      return NextResponse.json(
        { error: `Message must be under ${MAX_MESSAGE} characters` },
        { status: 400 },
      );
    }

    const topicLabel = TOPICS[topicKey];
    const subject = `Partner ticket — ${topicLabel} — ${distributor.clientname}`;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#EFECD3">
        <div style="background:#02422B;padding:16px;border-radius:8px;margin-bottom:16px;text-align:center">
          <h1 style="margin:0;color:#DABD38;font-family:Georgia,serif">Partner Ticket</h1>
        </div>
        <div style="background:#fff;padding:16px;border:1px solid #37584F;border-radius:8px">
          <p><strong>Raised via:</strong> myQode partner portal</p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString("en-IN")}</p>
          <div style="background:#EFECD3;padding:12px;border-left:4px solid #DABD38;margin:12px 0">
            <p><strong>Partner:</strong> ${esc(distributor.clientname)}</p>
            <p><strong>Email:</strong> ${esc(distributor.email)}</p>
            <p><strong>Topic:</strong> ${esc(topicLabel)}</p>
            ${aboutInvestor ? `<p><strong>About investor:</strong> ${esc(aboutInvestor)}</p>` : ""}
            <p><strong>Message:</strong></p>
            <p>${esc(message).replace(/\n/g, "<br/>")}</p>
          </div>
        </div>
      </div>`;

    // The inquiries table expects a nuvama_code. A distributor has none, so
    // the referral slug identifies them, prefixed to make the origin obvious
    // in the admin queue and to keep it from ever colliding with a real
    // client code.
    const partnerCode = `PARTNER:${distributor.referralSlug ?? distributor.email}`;

    let inquiryId: string | null = null;
    try {
      const result = await query(
        `INSERT INTO pms_clients_tracker.qode_microsite_inquiries
           (type, nuvama_code, client_id, user_email, subject, status, priority,
            data, email_to, email_from, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW(), NOW())
         RETURNING id`,
        [
          "distributor_ticket",
          partnerCode,
          null,
          distributor.email,
          subject,
          "pending",
          "normal",
          JSON.stringify({
            partner: distributor.clientname,
            topic: topicKey,
            topicLabel,
            aboutInvestor: aboutInvestor || null,
            message,
          }),
          PARTNERSHIPS,
          PARTNERSHIPS,
        ],
      );
      // lib/db1 query() resolves to a pg QueryResult, so rows come off .rows.
      inquiryId = result?.rows?.[0]?.id ?? null;
    } catch (err) {
      // A ticket that is mailed but unrecorded is still a ticket the team
      // will answer; one that is recorded but never mailed can sit unseen.
      // So a write failure is logged and the mail still goes out.
      console.error("[distributor/ticket] insert failed:", err);
    }

    await resend.emails.send({
      from: PARTNERSHIPS,
      to: [PARTNERSHIPS],
      replyTo: distributor.email,
      subject,
      html,
    });

    return NextResponse.json({ ok: true, inquiryId }, { status: 200 });
  } catch (err) {
    console.error("[distributor/ticket] failed:", err);
    return NextResponse.json(
      { error: "Could not raise the ticket" },
      { status: 500 },
    );
  }
}
