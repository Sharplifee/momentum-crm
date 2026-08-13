import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendSms } from "@/lib/sms";
import { runWayne } from "@/lib/wayne";
import { toE164 } from "@/lib/phone";
import { logAutomation } from "@/lib/automation";

export const runtime = "nodejs";
export const maxDuration = 60;

function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const secret = process.env.PINGRAM_WEBHOOK_SECRET;

  // Verify signature when Pingram sends one; the previously-live dispatcher
  // received unsigned posts, so an absent header is tolerated (logged) rather
  // than rejected — a hard 401 would silently kill all inbound SMS.
  const sig =
    req.headers.get("x-pingram-signature") ??
    req.headers.get("x-webhook-signature") ??
    req.headers.get("x-signature");
  if (secret && sig && !verifySignature(rawBody, sig, secret)) {
    await logAutomation({ trigger: "sms.inbound.bad_signature", status: "error" });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  if (secret && !sig) {
    await logAutomation({ trigger: "sms.inbound.unsigned", status: "skipped" });
  }

  const payload = JSON.parse(rawBody || "{}");
  // Tolerant extraction — Pingram inbound shape may evolve while it's the interim provider.
  // shapes observed from the live v5 dispatcher: from | sms.from | data.from,
  // text | message | sms.message | data.message, eventType SMS_INBOUND
  const fromRaw =
    payload?.from?.number ?? payload?.from ?? payload?.sms?.from ?? payload?.data?.from ?? payload?.sender ?? null;
  const text: string =
    payload?.sms?.message ?? payload?.message ?? payload?.text ?? payload?.data?.message ?? payload?.body ?? "";
  const providerId: string | null =
    payload?.id ?? payload?.message_id ?? payload?.sms?.id ?? payload?.data?.id ?? null;

  const phone = fromRaw ? toE164(String(fromRaw)) : null;
  if (!phone || !text) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const db = supabaseAdmin();

  // dedupe on provider message id (messages.provider_id is UNIQUE)
  if (providerId) {
    const { data: dupe } = await db
      .from("messages")
      .select("id")
      .eq("provider_id", providerId)
      .maybeSingle();
    if (dupe) return NextResponse.json({ ok: true, duplicate: true });
  }

  // upsert thread by phone
  let { data: thread } = await db
    .from("threads")
    .select("id, escalated, lead_id, customer_id")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!thread) {
    const { data: created } = await db
      .from("threads")
      .insert({ phone })
      .select("id, escalated, lead_id, customer_id")
      .single();
    thread = created!;
  }

  // store inbound message
  await db.from("messages").insert({
    thread_id: thread.id,
    channel: "sms",
    direction: "inbound",
    sender: "customer",
    body: text,
    provider_id: providerId,
    meta: { raw: payload },
  });
  await db.from("threads").update({ last_message_at: new Date().toISOString() }).eq("id", thread.id);
  await db.from("sms_events").insert({
    provider: "pingram",
    event_type: "inbound",
    payload,
  });

  const trimmed = text.trim().toUpperCase();

  // STOP — set opt-out, confirm once (compliance send bypasses quiet hours)
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(trimmed)) {
    const { data: existingCustomer } = await db
      .from("customers")
      .select("id, sms_opt_out")
      .eq("phone", phone)
      .maybeSingle();
    const alreadyOptedOut = existingCustomer?.sms_opt_out === true;
    if (existingCustomer) {
      await db.from("customers").update({ sms_opt_out: true }).eq("id", existingCustomer.id);
    } else {
      await db.from("customers").insert({
        full_name: "SMS opt-out (no account)",
        phone,
        status: "opted_out",
        sms_opt_out: true,
      });
    }
    if (!alreadyOptedOut) {
      // send confirmation BEFORE the opt-out row would block it — direct provider call not needed;
      // sendSms checks customers.sms_opt_out, so bypass by sending first? No — row already updated.
      // Compliance confirmations are exempt from opt-out blocking, so send via provider directly:
      const apiKey = process.env.PINGRAM_API_KEY;
      if (apiKey) {
        await fetch("https://api.pingram.io/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            type: "wayne_reply",
            to: { id: phone, number: phone },
            sms: { message: "You've been unsubscribed from Momentum Landscaping texts. Reply START to re-subscribe." },
          }),
        }).catch(() => null);
      }
    }
    await logAutomation({ trigger: "sms.inbound.stop", ref_id: thread.id, detail: { phone } });
    return NextResponse.json({ ok: true, action: "opt_out" });
  }

  // START — re-subscribe
  if (["START", "YES", "UNSTOP"].includes(trimmed) ) {
    const { data: existingCustomer } = await db
      .from("customers").select("id, sms_opt_out").eq("phone", phone).maybeSingle();
    if (existingCustomer?.sms_opt_out) {
      await db.from("customers").update({ sms_opt_out: false }).eq("id", existingCustomer.id);
      await sendSms({ to: phone, message: "You're re-subscribed to Momentum Landscaping texts. 🌱", thread_id: thread.id, sender: "system", bypassQuietHours: true });
      return NextResponse.json({ ok: true, action: "opt_in" });
    }
    // fall through to Wayne if they weren't opted out (a "YES" mid-conversation is a real reply)
  }

  // HELP
  if (trimmed === "HELP" || trimmed === "INFO") {
    await sendSms({
      to: phone,
      message:
        "Momentum Landscaping: lawn care in Salt Lake County. Msg&data rates may apply. Reply STOP to opt out. Questions: momentumlandscapingut.com",
      thread_id: thread.id,
      sender: "system",
      bypassQuietHours: true,
    });
    return NextResponse.json({ ok: true, action: "help" });
  }

  // escalated thread — store only, human handles it
  if (thread.escalated) {
    await logAutomation({ trigger: "sms.inbound.escalated_stored", ref_id: thread.id });
    return NextResponse.json({ ok: true, action: "stored_escalated" });
  }

  // link lead by phone if the thread doesn't have one yet
  let leadId = thread.lead_id;
  if (!leadId) {
    const { data: lead } = await db
      .from("leads")
      .select("id")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lead) {
      leadId = lead.id;
      await db.from("threads").update({ lead_id: lead.id }).eq("id", thread.id);
    }
  }

  // link customer by phone if not yet linked (Wayne v2: existing customers text in)
  let customerId = thread.customer_id;
  if (!customerId) {
    const { data: cust } = await db.from("customers").select("id").eq("phone", phone).maybeSingle();
    if (cust) {
      customerId = cust.id;
      await db.from("threads").update({ customer_id: cust.id }).eq("id", thread.id);
    }
  }

  // invoke Wayne and reply
  const reply = await runWayne(
    { thread_id: thread.id, phone, lead_id: leadId, customer_id: customerId, channel: "sms" },
    text
  ).catch(async (err) => {
    // Wayne failure (e.g. model API down/out of credits) must never 500 the webhook —
    // message is already stored; escalate so a human follows up.
    await logAutomation({ trigger: "wayne.sms_error", status: "error", ref_id: thread.id, error: String(err) });
    await db.from("threads").update({ escalated: true }).eq("id", thread.id);
    return null;
  });
  if (reply) {
    await sendSms({ to: phone, message: reply, thread_id: thread.id, sender: "wayne" });
  }

  return NextResponse.json({ ok: true, replied: Boolean(reply) });
}
