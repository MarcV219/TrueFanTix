import Link from "next/link";

export const metadata = {
  title: "Report an Issue | TrueFanTix",
};

export default function ReportIssuePage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <section className="bg-[#064a93] py-12">
        <div className="max-w-5xl mx-auto px-6">
          <h1 className="text-4xl md:text-5xl font-bold mb-4" style={{ color: "#e6edf5" }}>
            Report an Issue
          </h1>
          <p className="text-xl" style={{ color: "#e6edf5" }}>
            Found a bug or something broken? Send us details and we&apos;ll jump on it.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-12">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8">
          <p className="text-[var(--foreground)]/80 leading-relaxed">
            If something looks wrong, we want to know. The fastest way is to email{" "}
            <a className="underline" href="mailto:support@truefantix.com">
              support@truefantix.com
            </a>{" "}
            with:
          </p>
          <ul className="list-disc pl-6 mt-4 text-[var(--foreground)]/80 space-y-1">
            <li>What you were trying to do</li>
            <li>The page URL</li>
            <li>Any screenshots (if possible)</li>
            <li>The exact error text</li>
          </ul>

          <div className="mt-8">
            <Link className="underline" href="/">
              Back to Home
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
