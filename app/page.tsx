import Link from "next/link";

/**
 * Placeholder root page. In production the domain root is served by
 * Connor's Claude Design site (project momentum-site) — this page only
 * shows on the app's own vercel.app URL / crm+portal subdomains.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold text-moss">Momentum Landscaping</h1>
      <p className="text-lg text-stone-600">
        Lawn care that shows up. Serving Salt Lake County.
      </p>
      <Link
        href="/quote"
        className="rounded-lg bg-moss px-6 py-3 font-semibold text-white hover:opacity-90"
      >
        Request a personal quote
      </Link>
      <p className="text-sm text-stone-400">
        <Link href="/legal/terms" className="underline">Terms</Link> ·{" "}
        <Link href="/legal/privacy" className="underline">Privacy</Link> ·{" "}
        <Link href="/legal/sms-terms" className="underline">SMS Terms</Link> ·{" "}
        <Link href="/legal/ai-disclosure" className="underline">AI Disclosure</Link>
      </p>
    </main>
  );
}
