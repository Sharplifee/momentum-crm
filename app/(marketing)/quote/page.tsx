import { activeServiceCities } from "@/lib/zones";
import { logAutomation } from "@/lib/automation";
import { QuoteForm } from "./QuoteForm";

// The city list is a live promise of serviceability, so it must never be
// cached past a zone change. Deactivating a zone takes it off this form on the
// next request, with no deploy.
export const dynamic = "force-dynamic";

/**
 * ⚠️ STALE-TOLERANT FALLBACK — **NOT** A SOURCE OF TRUTH. ⚠️
 *
 * Editing this array does NOT change where Momentum works, and it is not how
 * you add or drop a city. Coverage lives in ONE place: the `zones` table.
 * Deactivate the zone (`active = false`) and every surface follows — this form,
 * Wayne, all of it. We deleted five hardcoded city lists on 2026-08-03 for
 * exactly this reason; they kept advertising Utah County a week after we left
 * it and kept generating leads nobody could fulfill. Do not start a sixth.
 *
 * This exists only so a Supabase outage degrades to yesterday's truth instead
 * of a blank dropdown. This is the highest-value lead-capture page in the
 * product: a slightly stale list costs one wrongly-accepted lead we can decline
 * politely, while an empty list silently costs EVERY lead until someone
 * notices. Stale beats absent, and only for that reason.
 *
 * Derived by querying the live zones table on 2026-08-03 (all active zones,
 * deduped, alphabetical — the same shape `activeServiceCities()` returns).
 * If it drifts from the table, the table is right and this is wrong.
 */
const FALLBACK_CITIES = [
  "Bluffdale", "Copperton", "Cottonwood Heights", "Daybreak", "Draper",
  "Granite", "Herriman", "Midvale", "Riverton", "Rosecrest", "Sandy",
  "South Jordan", "Suncrest", "West Jordan", "White City",
];

export default async function QuotePage() {
  let cities = FALLBACK_CITIES;
  let degraded: string | null = null;

  try {
    const live = await activeServiceCities();
    // An empty result is a failure signal, not a real answer: supabase-js
    // returns { data: null, error } rather than throwing, so a dead database
    // surfaces here as [] — and Momentum always serves at least one zone.
    if (live.length) cities = live;
    else degraded = "zones query returned no active cities";
  } catch (err) {
    degraded = err instanceof Error ? err.message : String(err);
  }

  if (degraded) {
    // A fallback nobody can see has the same problem as the failure it covers.
    // Guarded because the outage that triggers this is the same one that can
    // take the audit insert down with it — observability must never be what
    // breaks the lead form.
    await logAutomation({
      trigger: "quote_form.city_list_fallback",
      status: "error",
      detail: { reason: degraded, served_cities: cities.length },
      error: degraded,
    }).catch(() => {});
  }

  return <QuoteForm cities={cities} />;
}
