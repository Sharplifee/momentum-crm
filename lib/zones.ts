import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Every city/community we currently serve, read from the zones table.
 *
 * This is the ONLY place customer-facing surfaces should get a service-area
 * list. Hand-written lists go stale silently and cost real money: when Utah
 * County was deactivated on 2026-08-01, five separate hardcoded lists kept
 * advertising it and kept generating leads nobody could fulfill. Deactivating
 * a zone must be enough to take it off the site, the quote form, and Wayne.
 *
 * Deduped (cities span zones) and alphabetical — zone order is an internal
 * routing concern and means nothing to a homeowner picking their city.
 */
export async function activeServiceCities(): Promise<string[]> {
  const db = supabaseAdmin();
  const { data: zones } = await db.from("zones").select("cities").eq("active", true).order("id");
  const seen = new Set<string>();
  for (const z of zones ?? []) {
    for (const c of (z.cities as string[]) ?? []) seen.add(c);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * Resolve a zone from explicit city and/or free-text address (punch list 1.1).
 * Case-insensitive match against zones.cities; multi-zone cities take the
 * lowest zone id; unresolvable falls back to system_config.default_zone.
 * Returns { zone_id, city } — city is the matched canonical name when found.
 */
export async function resolveZone(city: string | null | undefined, address: string | null | undefined) {
  const db = supabaseAdmin();
  const { data: zones } = await db.from("zones").select("id, cities").eq("active", true).order("id");
  const haystack = `${city ?? ""} ${address ?? ""}`.toLowerCase();

  let matched: { zone_id: number; city: string } | null = null;
  for (const z of zones ?? []) {
    for (const c of (z.cities as string[]) ?? []) {
      if (haystack.includes(c.toLowerCase())) {
        if (!matched || z.id < matched.zone_id) matched = { zone_id: z.id, city: c };
      }
    }
    if (matched && matched.zone_id === zones?.[0]?.id) break;
  }
  if (matched) return matched;

  const { data: dz } = await db.from("system_config").select("value").eq("key", "default_zone").single();
  const defaultZone = typeof dz?.value === "number" ? dz.value : parseInt(String(dz?.value ?? "1"), 10);
  return { zone_id: Number.isFinite(defaultZone) ? defaultZone : 1, city: city ?? null };
}
