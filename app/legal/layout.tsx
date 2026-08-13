export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="legal mx-auto max-w-3xl p-8 leading-relaxed [&_h1]:mb-4 [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_a]:underline">
      {children}
      <hr className="my-6" />
      <p className="text-sm text-stone-500">
        Momentum Landscaping · Salt Lake County, UT · momentumlandscapingut.com
      </p>
    </main>
  );
}
