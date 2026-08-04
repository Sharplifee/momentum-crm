"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

function readCookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((c) => c.startsWith(name + "="))
    ?.split("=")[1];
}

type AddressSuggestion = { address: string; city: string | null; exact: boolean };

/**
 * Address entry backed by real county parcel records — typing shows the actual
 * parcels that exist so a lead lands on a surveyed property instead of a
 * free-text guess the GPS geofencing can never match later.
 */
function AddressAutocomplete({ onSelect }: { onSelect: (s: { address: string; city: string | null }) => void }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [verified, setVerified] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  function handleChange(v: string) {
    setQuery(v);
    setVerified(false);
    onSelect({ address: v, city: null });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.trim().length < 4) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tracking/address-suggest?q=${encodeURIComponent(v)}`);
        const json = await res.json();
        setSuggestions(json.suggestions ?? []);
        setOpen((json.suggestions ?? []).length > 0);
      } catch {
        setSuggestions([]);
      }
    }, 300);
  }

  function pick(s: AddressSuggestion) {
    const titleCased = s.address.replace(/\w\S*/g, (w) => w[0] + w.slice(1).toLowerCase());
    setQuery(titleCased);
    setVerified(true);
    setOpen(false);
    onSelect({ address: titleCased, city: s.city });
  }

  return (
    <div className="relative">
      <input
        name="address"
        required
        placeholder="Street address"
        autoComplete="off"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(suggestions.length > 0)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full rounded-lg border border-stone-300 p-3"
      />
      {verified && (
        <span className="absolute right-3 top-3 text-xs font-medium text-moss">✓ verified</span>
      )}
      {open && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-stone-200 bg-white shadow-lg">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={() => pick(s)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-stone-50"
              >
                {s.address}{s.city ? `, ${s.city}` : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * `cities` comes from the zones table via the server component in page.tsx —
 * never hardcode it here. A city dropdown is a promise of serviceability, so
 * it has to track zone deactivations on its own.
 */
export function QuoteForm({ cities }: { cities: string[] }) {
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [addr, setAddr] = useState<{ address: string; city: string | null }>({ address: "", city: null });
  const [tracking, setTracking] = useState<{ fbclid?: string; fbp?: string; utm?: Record<string, string>; landing_page?: string; referrer?: string }>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    for (const k of ["source", "medium", "campaign", "content", "term"]) {
      const v = params.get(`utm_${k}`);
      if (v) utm[k] = v;
    }
    setTracking({
      fbclid: params.get("fbclid") ?? undefined,
      fbp: readCookie("_fbp"),
      utm: Object.keys(utm).length ? utm : undefined,
      landing_page: window.location.href,
      referrer: document.referrer || undefined,
    });
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    const form = new FormData(e.currentTarget);
    const payload = {
      full_name: String(form.get("full_name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      email: String(form.get("email") ?? "") || undefined,
      address: String(form.get("address") ?? ""),
      city: addr.city ?? (String(form.get("city") ?? "") || undefined),
      service_interest: String(form.get("service_interest") ?? "") || undefined,
      company_website: String(form.get("company_website") ?? "") || undefined, // honeypot
      ...tracking,
    };
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong");
      // pixel-side Lead with matching event_id → dedupes against server CAPI event
      if (window.fbq && json.lead_id) {
        window.fbq("track", "Lead", {}, { eventID: json.lead_id });
      }
      setStatus("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <main className="mx-auto max-w-lg p-8 text-center">
        <h1 className="mb-4 text-3xl font-bold text-moss">You're all set 🌱</h1>
        <p className="text-stone-600">
          Wayne, our scheduling assistant, is texting you now to get a personal quote visit on the
          calendar. Keep an eye on your phone!
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="mb-2 text-3xl font-bold text-moss">Request Your Personal Quote</h1>
      <p className="mb-6 text-stone-600">
        Tell us about your yard and we'll text you to schedule an in-person visit — every quote is
        personal to your property.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input name="full_name" required minLength={2} placeholder="Full name" className="rounded-lg border border-stone-300 p-3" />
        <input name="phone" required type="tel" placeholder="Mobile number" className="rounded-lg border border-stone-300 p-3" />
        <input name="email" type="email" placeholder="Email (optional)" className="rounded-lg border border-stone-300 p-3" />
        <AddressAutocomplete onSelect={setAddr} />
        <select name="city" required className="rounded-lg border border-stone-300 p-3" value={addr.city ?? ""} onChange={(e) => setAddr((a) => ({ ...a, city: e.target.value || null }))}>
          <option value="" disabled>City</option>
          {cities.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select name="service_interest" className="rounded-lg border border-stone-300 p-3" defaultValue="">
          <option value="">What do you need?</option>
          <option value="weekly-mow">Weekly mowing ($45/visit)</option>
          <option value="biweekly-mow">Biweekly mowing ($55/visit)</option>
          <option value="aeration">Aeration ($89)</option>
          <option value="cleanup">Spring/Fall cleanup (quoted)</option>
          <option value="addons">Landscaping add-ons (quoted)</option>
        </select>
        {/* honeypot — hidden from humans */}
        <input name="company_website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
        <button
          type="submit"
          disabled={status === "sending"}
          className="rounded-lg bg-moss px-6 py-3 font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {status === "sending" ? "Sending…" : "Request my personal quote"}
        </button>
        {status === "error" && <p className="text-sm text-red-600">{errorMsg}</p>}
        <p className="text-xs text-stone-400">
          By submitting you agree to receive texts from Momentum Landscaping (incl. our AI assistant
          Wayne). Msg&nbsp;&amp;&nbsp;data rates may apply. Reply STOP to opt out. See our{" "}
          <a href="/legal/sms-terms" className="underline">SMS Terms</a> and{" "}
          <a href="/legal/privacy" className="underline">Privacy Policy</a>.
        </p>
      </form>
    </main>
  );
}
