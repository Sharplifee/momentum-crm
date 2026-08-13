import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAvailability } from "@/lib/availability";
import { activeServiceCities } from "@/lib/zones";
import { sendSms } from "@/lib/sms";
import { sendMetaCapiEvent } from "@/lib/meta";
import { logAutomation } from "@/lib/automation";

const SYSTEM_PROMPT_BASE = `You are Wayne, the AI assistant for Momentum Landscaping in Salt Lake County, Utah.

HARD RULES — never violate these:
1. AI SELF-IDENTIFICATION (Utah AI safe-harbor): If a customer asks whether you are an AI, a bot, or a real person, answer truthfully that you are Momentum's AI assistant. Never claim to be human.
2. NEVER invent dates or availability, and NEVER quote a price — pricing is always set at the in-person quote visit. Only offer days that come from the check_availability tool. If you don't know, say you'll check with the team and use escalate_to_human.
3. ONE question per message. Keep messages short — this is SMS. No walls of text, no markdown.
4. Respect quiet hours: the platform blocks sends outside 8am–9pm; don't promise late-night replies.
5. ESCALATE to a human (escalate_to_human tool) when: a customer reports damage or a complaint, asks for a refund or discount, is angry, asks something you can't answer from your knowledge, or asks to speak to a person. After escalating, tell them a team member will follow up shortly.
6. Booking is real: when a customer picks a day, use book_job. Never say "you're booked" without a successful book_job call.
7. Never share other customers' information. Never discuss internal operations, margins, or team details.
8. Never state or promise a specific arrival time window (e.g. "8am–10am", "morning") to a customer — confirm the day only. Never say a quote will be sent by phone or text — quotes require an in-person visit; you're scheduling that visit, not delivering a price.

TONE: Friendly, brief, Utah-neighborly. Use the customer's first name. An occasional 🌱 is on-brand; don't overdo emojis.

PRICING: Momentum does not publish or quote prices over text. Every property is different, so pricing is set at an in-person quote visit. If a customer asks about price or cost, say plainly that pricing is customized per property and offer to get a quote visit on the calendar — then use check_availability and book_job. Never state, estimate, or hint at a dollar figure for any service, even if pressed or if the customer names a number.

SERVICE AREA: The cities and communities Momentum actively serves are listed under ACTIVE SERVICE AREA below. That list is the only coverage you may treat as confirmed — never state or imply that we serve a city that is not on it.

Absence from that list is NOT a rejection, and it is not yours to decide. Never turn a customer away or refuse to help based on their location, and never tell a customer that they are outside our area or that we don't serve them. If a property isn't on the list, or you're unsure whether it's serviceable, do not say no — take their information, tell them the team will confirm and follow up, and use escalate_to_human so a real person checks and reaches out. A lead we capture and refer is worth far more than one we turn away.

SEASON: April 1 – November 15. Off-season inquiries: take their info, note interest with log_note, tell them we'll reach out at season start.`;

const tools: Anthropic.Tool[] = [
  {
    name: "check_availability",
    description:
      "Get the next available service days for the customer's zone. Always call this before offering days.",
    input_schema: {
      type: "object" as const,
      properties: {
        zone_id: { type: "number", description: "Zone id for the customer's property" },
        count: { type: "number", description: "How many days to fetch (default 2)" },
      },
      required: ["zone_id"],
    },
  },
  {
    name: "book_job",
    description:
      "Book a job on a specific date for this lead/customer. Atomic: creates the job, increments capacity, sends the confirmation SMS, alerts the team, and fires the Schedule conversion event. Only call after the customer clearly picked a date.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: { type: "string", description: "YYYY-MM-DD date the customer chose" },
        service_slug: {
          type: "string",
          description:
            "Service slug: weekly-mow, biweekly-mow, aeration, curb-strips, cleanup, addons",
        },
        notes: { type: "string", description: "Anything the crew should know (gate code, dogs, etc.)" },
      },
      required: ["date", "service_slug"],
    },
  },
  {
    name: "log_note",
    description: "Record an internal note on this lead's timeline (not visible to the customer).",
    input_schema: {
      type: "object" as const,
      properties: { note: { type: "string" } },
      required: ["note"],
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Flag this conversation for human takeover and alert the owner. After this, you stop handling the thread.",
    input_schema: {
      type: "object" as const,
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
  {
    name: "reschedule_job",
    description:
      "Move an existing job to a new date (capacity-checked). Use when a customer asks to reschedule. Confirm the new date with them first.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: { type: "string", description: "Job id to move" },
        new_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["job_id", "new_date"],
    },
  },
  {
    name: "create_quote",
    description:
      "Create a catalog-priced quote for this lead. Line items must use real service slugs; totals come from the services table — never invent prices.",
    input_schema: {
      type: "object" as const,
      properties: {
        service_slugs: { type: "array", items: { type: "string" }, description: "Service slugs to include" },
      },
      required: ["service_slugs"],
    },
  },
  {
    name: "get_customer_context",
    description:
      "Fetch an existing customer's upcoming jobs, agreement, and property notes by phone. Use when someone texting in appears to be an existing customer.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
];

export type WayneContext = {
  thread_id: string;
  phone: string;
  lead_id?: string | null;
  customer_id?: string | null;
  channel?: "sms" | "portal"; // portal = verified identity, skip phone-matching ambiguity
};

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: WayneContext
): Promise<string> {
  const db = supabaseAdmin();

  if (name === "check_availability") {
    const zoneId = Number(input.zone_id);
    const days = await getAvailability(zoneId, Number(input.count ?? 2));
    return JSON.stringify({ available_days: days });
  }

  if (name === "book_job") {
    const date = String(input.date);
    const serviceSlug = String(input.service_slug);
    const { data: service } = await db
      .from("services")
      .select("id, name, base_price")
      .eq("slug", serviceSlug)
      .single();
    if (!service) return JSON.stringify({ error: `unknown service ${serviceSlug}` });

    // resolve zone + crew from the lead
    let zoneId: number | null = null;
    let leadName = "Customer";
    let leadAddress = "";
    if (ctx.lead_id) {
      const { data: lead } = await db
        .from("leads")
        .select("zone_id, full_name, address")
        .eq("id", ctx.lead_id)
        .single();
      zoneId = lead?.zone_id ?? null;
      leadName = lead?.full_name ?? leadName;
      leadAddress = lead?.address ?? "";
    }
    if (!zoneId) return JSON.stringify({ error: "no zone on file — escalate instead" });

    const { data: crew } = await db
      .from("crews")
      .select("id, max_daily_jobs")
      .eq("home_zone", zoneId)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (!crew) return JSON.stringify({ error: "no active crew for zone" });

    // capacity upsert + guard
    const { data: cap } = await db
      .from("capacity")
      .select("slots_total, slots_booked")
      .eq("crew_id", crew.id)
      .eq("day", date)
      .maybeSingle();
    const slotsTotal = cap?.slots_total ?? crew.max_daily_jobs ?? 12;
    const slotsBooked = cap?.slots_booked ?? 0;
    if (slotsBooked >= slotsTotal) {
      return JSON.stringify({ error: "day_full", message: "That day just filled up — offer another." });
    }

    const { data: job, error: jobErr } = await db
      .from("jobs")
      .insert({
        service_id: service.id,
        crew_id: crew.id,
        zone_id: zoneId,
        scheduled_date: date,
        status: "scheduled",
        price: service.base_price,
        notes: input.notes ? String(input.notes) : null,
      })
      .select("id")
      .single();
    if (jobErr || !job) return JSON.stringify({ error: jobErr?.message ?? "job insert failed" });

    await db
      .from("capacity")
      .upsert(
        { crew_id: crew.id, day: date, slots_total: slotsTotal, slots_booked: slotsBooked + 1 },
        { onConflict: "crew_id,day" }
      );

    if (ctx.lead_id) {
      await db.from("lead_events").insert({
        lead_id: ctx.lead_id,
        type: "job_booked",
        detail: { job_id: job.id, date, service: serviceSlug },
        actor: "wayne",
      });
      await db.from("leads").update({ stage: "closed_won", last_contact_at: new Date().toISOString() }).eq("id", ctx.lead_id);
    }

    // confirmation SMS via template
    const { data: tpl } = await db.from("sms_templates").select("body").eq("name", "booking_confirmed").single();
    const dayName = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    if (tpl) {
      const bodyTxt = tpl.body
        .replace("{day}", dayName)
        .replace("{window}", "")
        .replace("{address}", leadAddress);
      await sendSms({ to: ctx.phone, message: bodyTxt, thread_id: ctx.thread_id, sender: "wayne" });
    }

    // team alert
    const { data: alertCfg } = await db.from("system_config").select("value").eq("key", "team_alerts").single();
    const recipients = (alertCfg?.value?.mode === "launch"
      ? alertCfg.value.launch_recipients
      : alertCfg?.value?.recipients) as string[] | undefined;
    for (const r of recipients ?? []) {
      await sendSms({
        to: r,
        message: `Wayne booked: ${leadName} — ${service.name} on ${dayName} at ${leadAddress}.`,
        sender: "system",
        bypassQuietHours: true,
      });
    }

    // CAPI Schedule
    await sendMetaCapiEvent({
      event_name: "Schedule",
      event_id: job.id,
      phone: ctx.phone,
      lead_id: ctx.lead_id ?? null,
      job_id: job.id,
      action_source: "system_generated",
      value: service.base_price ? Number(service.base_price) : undefined,
    });

    await logAutomation({
      trigger: "wayne.book_job",
      ref_id: job.id,
      detail: { date, service: serviceSlug, lead_id: ctx.lead_id },
    });

    return JSON.stringify({ ok: true, job_id: job.id, date, day_name: dayName, service: service.name });
  }

  if (name === "log_note") {
    if (ctx.lead_id) {
      await db.from("lead_events").insert({
        lead_id: ctx.lead_id,
        type: "note",
        detail: { note: String(input.note) },
        actor: "wayne",
      });
    }
    return JSON.stringify({ ok: true });
  }

  if (name === "escalate_to_human") {
    await db.from("threads").update({ escalated: true }).eq("id", ctx.thread_id);
    const { data: alertCfg } = await db.from("system_config").select("value").eq("key", "team_alerts").single();
    const recipients = (alertCfg?.value?.mode === "launch"
      ? alertCfg.value.launch_recipients
      : alertCfg?.value?.recipients) as string[] | undefined;
    for (const r of recipients ?? []) {
      await sendSms({
        to: r,
        message: `⚠️ Wayne escalated a conversation (${ctx.phone}). Reason: ${String(input.reason)}. Reply to the customer directly.`,
        sender: "system",
        bypassQuietHours: true,
      });
    }
    await logAutomation({
      trigger: "wayne.escalate",
      ref_id: ctx.thread_id,
      detail: { reason: String(input.reason) },
    });
    return JSON.stringify({ ok: true, escalated: true });
  }

  if (name === "reschedule_job") {
    const jobId = String(input.job_id);
    const newDate = String(input.new_date);
    const { data: job } = await db.from("jobs").select("id, crew_id, scheduled_date, customer_id").eq("id", jobId).single();
    if (!job) return JSON.stringify({ error: "job not found" });
    // capacity check on target day
    const { data: crew } = await db.from("crews").select("id, max_daily_jobs").eq("id", job.crew_id).single();
    const { data: cap } = await db.from("capacity").select("slots_total, slots_booked").eq("crew_id", job.crew_id).eq("day", newDate).maybeSingle();
    const { count: jobsThatDay } = await db.from("jobs").select("id", { count: "exact", head: true }).eq("crew_id", job.crew_id).eq("scheduled_date", newDate).neq("status", "cancelled");
    const total = cap?.slots_total ?? crew?.max_daily_jobs ?? 12;
    const booked = Math.max(cap?.slots_booked ?? 0, jobsThatDay ?? 0);
    if (booked >= total) return JSON.stringify({ error: "day_full", message: "That day is full — offer another." });
    await db.from("jobs").update({ scheduled_date: newDate, weather_flag: false }).eq("id", jobId);
    await db.from("job_events").insert({ job_id: jobId, type: "rescheduled", note: `→ ${newDate}`, actor: "wayne" });
    await sendSms({ to: ctx.phone, message: `Done — your visit is moved to ${new Date(newDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}. 🌱`, thread_id: ctx.thread_id, sender: "wayne" });
    await logAutomation({ trigger: "wayne.reschedule_job", ref_id: jobId, detail: { new_date: newDate } });
    return JSON.stringify({ ok: true, job_id: jobId, new_date: newDate });
  }

  if (name === "create_quote") {
    const slugs = (input.service_slugs as string[]) ?? [];
    const { data: services } = await db.from("services").select("name, slug, base_price").in("slug", slugs);
    if (!services?.length) return JSON.stringify({ error: "no valid services" });
    const unpriced = services.filter((s) => s.base_price == null);
    const items = services.filter((s) => s.base_price != null).map((s) => ({ service: s.name, qty: 1, price: Number(s.base_price) }));
    const total = items.reduce((sum, i) => sum + i.price, 0);
    const { data: quote } = await db.from("quotes").insert({ lead_id: ctx.lead_id, customer_id: ctx.customer_id, line_items: items, total, status: "draft" }).select("id").single();
    await logAutomation({ trigger: "wayne.create_quote", ref_id: quote?.id, detail: { total, slugs } });
    return JSON.stringify({ ok: true, quote_id: quote?.id, total, items, needs_visit: unpriced.map((s) => s.slug) });
  }

  if (name === "get_customer_context") {
    const { data: customer } = await db.from("customers").select("id, full_name, status, lifetime_value").eq("phone", ctx.phone).maybeSingle();
    if (!customer) return JSON.stringify({ found: false });
    const [{ data: jobs }, { data: agreement }, { data: props }] = await Promise.all([
      db.from("jobs").select("id, scheduled_date, status, services(name)").eq("customer_id", customer.id).gte("scheduled_date", new Date().toISOString().slice(0, 10)).order("scheduled_date").limit(5),
      db.from("service_agreements").select("frequency, price_per_visit, day_of_week").eq("customer_id", customer.id).eq("active", true).maybeSingle(),
      db.from("properties").select("address, gate_code, pets, access_notes").eq("customer_id", customer.id),
    ]);
    return JSON.stringify({ found: true, customer: { name: customer.full_name, status: customer.status }, upcoming_jobs: jobs, agreement, properties: props });
  }

  return JSON.stringify({ error: `unknown tool ${name}` });
}

/**
 * Runs the Wayne agent loop for a thread and returns the final text reply
 * (or null if Wayne ended on a tool call with nothing to say — rare).
 */
export async function runWayne(ctx: WayneContext, incomingMessage: string): Promise<string | null> {
  const db = supabaseAdmin();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // model from system_config (fallback to a safe default)
  const { data: wayneCfg } = await db.from("system_config").select("value").eq("key", "wayne").single();
  const model = (wayneCfg?.value?.model as string) ?? "claude-sonnet-4-5";

  // context: service area + lead + property + last 20 messages + knowledge
  let contextBlock = "";

  // Read live so deactivating a zone stops Wayne claiming it on the next
  // message — no deploy, no prompt edit. The SERVICE AREA policy above governs
  // what he may do with this list; he may confirm coverage from it, never
  // reject from its absence.
  const serviceCities = await activeServiceCities();
  if (serviceCities.length) {
    contextBlock += `\n\nACTIVE SERVICE AREA (live from the zones table): ${serviceCities.join(", ")}.`;
  }
  if (ctx.channel === "portal") {
    contextBlock += `\n\nCHANNEL: customer portal — this person is LOGGED IN and identity-verified. Do not ask who they are. Reschedule rule: if their requested change is more than 24 hours before the visit, handle it yourself with check_availability/reschedule_job; if it's within 24 hours, tell them you've sent it to the team to confirm (a request has been logged).`;
  }
  if (ctx.customer_id) {
    const { data: cust } = await db.from("customers").select("full_name, status").eq("id", ctx.customer_id).single();
    if (cust) contextBlock += `\n\nVERIFIED CUSTOMER: ${cust.full_name} (${cust.status})`;
  }
  if (ctx.lead_id) {
    const { data: lead } = await db
      .from("leads")
      .select("full_name, address, city, zone_id, service_interest, requested_window, stage")
      .eq("id", ctx.lead_id)
      .single();
    if (lead) {
      contextBlock += `\n\nCURRENT LEAD:\nName: ${lead.full_name}\nAddress: ${lead.address}, ${lead.city ?? ""}\nZone: ${lead.zone_id ?? "unknown"}\nInterested in: ${lead.service_interest ?? "unspecified"}\nRequested window: ${lead.requested_window ?? "unspecified"}\nStage: ${lead.stage}`;
    }
  }

  // naive keyword knowledge lookup (v1 per plan — ilike over wayne_knowledge)
  const keywords = incomingMessage
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5);
  if (keywords.length) {
    const orFilter = keywords.map((k) => `content.ilike.%${k}%`).join(",");
    const { data: knowledge } = await db
      .from("wayne_knowledge")
      .select("content")
      .or(orFilter)
      .limit(5);
    if (knowledge?.length) {
      contextBlock += `\n\nRELEVANT KNOWLEDGE:\n${knowledge.map((k) => `- ${k.content}`).join("\n")}`;
    }
  }

  const { data: history } = await db
    .from("messages")
    .select("direction, sender, body, created_at")
    .eq("thread_id", ctx.thread_id)
    .order("created_at", { ascending: false })
    .limit(20);

  const historyMessages: Anthropic.MessageParam[] = (history ?? [])
    .reverse()
    .map((m) => ({
      role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
      content: m.body,
    }));

  // collapse consecutive same-role messages (Anthropic requires alternation)
  const collapsed: Anthropic.MessageParam[] = [];
  for (const m of historyMessages) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n${m.content}`;
    } else {
      collapsed.push({ ...m });
    }
  }
  if (collapsed.length === 0 || collapsed[collapsed.length - 1].role !== "user") {
    collapsed.push({ role: "user", content: incomingMessage });
  }
  if (collapsed[0]?.role !== "user") {
    collapsed.unshift({ role: "user", content: "(conversation started)" });
  }

  let messages: Anthropic.MessageParam[] = collapsed;
  let totalIn = 0;
  let totalOut = 0;
  let finalText: string | null = null;

  for (let turn = 0; turn < 6; turn++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT_BASE + contextBlock,
      tools,
      messages,
    });
    totalIn += response.usage.input_tokens;
    totalOut += response.usage.output_tokens;

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );

    if (response.stop_reason !== "tool_use") {
      finalText = textBlocks.map((b) => b.text).join("\n").trim() || null;
      break;
    }

    messages = [...messages, { role: "assistant", content: response.content }];
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const result = await executeTool(tu.name, tu.input as Record<string, unknown>, ctx);
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }
    messages = [...messages, { role: "user", content: toolResults }];
  }

  await logAutomation({
    trigger: "wayne.run",
    ref_id: ctx.thread_id,
    detail: { model, input_tokens: totalIn, output_tokens: totalOut },
  });

  return finalText;
}
