import Link from "next/link";

export const metadata = {
  title: "Report an Issue | TrueFanTix",
};

export default function ReportIssuePage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold mb-4">Report an Issue</h1>
      <p className="text-[var(--foreground)]/80 leading-relaxed">
        If something looks wrong, we want to know. The fastest way is to email{" "}
        <a className="underline" href="mailto:support@truefantix.com">
          support@truefantix.com
        </a>
        {" "}with:
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
    </main>
  );
}
