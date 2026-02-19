import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Terms of Service | TrueFanTix",
  description: "Terms and conditions for using TrueFanTix - the fan-first ticket marketplace.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[#064a93] py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4" style={{ color: "#e6edf5" }}>Terms of Service</h1>
          <p className="text-xl" style={{ color: "#e6edf5" }}>By using TrueFanTix, you agree to the following</p>
        </div>
      </section>

      {/* Content */}
      <section className="py-12 px-4 flex-1">
        <div className="max-w-4xl mx-auto space-y-8">
          
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Agreement to Terms
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
              <strong>Last Updated:</strong> February 18, 2026
            </p>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              By using TrueFanTix, you agree to abide by these Terms of Service. Please read them carefully.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              1. List Tickets Truthfully
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              You agree to list only tickets that you legally own and have the right to sell. All listing 
              information must be accurate, including event details, seat information, and ticket authenticity. 
              Misrepresentation is grounds for immediate account suspension.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              2. Respect Face-Value Pricing Rules
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              TrueFanTix enforces a strict face-value pricing policy. You agree to list tickets at or below 
              face value (including any original fees you paid). Attempting to list above face value or 
              circumventing this rule will result in listing removal and potential account suspension.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              3. No Off-Platform Transactions
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              You agree not to attempt to move transactions off the TrueFanTix platform. This includes 
              exchanging contact information to arrange private sales, requesting payment outside our 
              secure system, or any other attempt to bypass our escrow and verification processes. 
              Off-platform transactions void all protections and may result in permanent account ban.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              4. Follow Dispute Procedures
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              In the event of a dispute, you agree to participate in good faith in our dispute resolution 
              process. This includes providing requested evidence in a timely manner and accepting the 
              final determination made by TrueFanTix administrators.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              5. Treat Everyone with Courtesy and Respect
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              You agree to treat all users—buyers, sellers, and staff—with courtesy and respect. 
              Harassment, abusive language, threats, or discriminatory behavior will not be tolerated.
            </p>
          </div>

          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-8">
            <h2 className="text-2xl font-bold text-red-900 dark:text-red-300 mb-4">
              Violation of Terms
            </h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              Violation of these terms may result in account suspension or permanent termination. 
              We reserve the right to take appropriate action against any user who violates these 
              terms or engages in fraudulent, abusive, or harmful behavior on the platform.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Additional Policies
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
              These Terms of Service work in conjunction with our other policies:
            </p>
            <ul className="space-y-2">
              <li>
                <Link href="/privacy" className="text-blue-600 hover:underline">Privacy Policy</Link>
              </li>
              <li>
                <Link href="/pricing-policy" className="text-blue-600 hover:underline">Pricing & Fee Policy</Link>
              </li>
              <li>
                <Link href="/community-guidelines" className="text-blue-600 hover:underline">Community Guidelines</Link>
              </li>
            </ul>
          </div>

          {/* Navigation Buttons */}
          <div className="mt-12 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/privacy"
              className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center"
            >
              Next: Privacy Policy →
            </Link>
            <Link
              href="/tickets"
              className="inline-block bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white px-8 py-3 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition text-center"
            >
              Browse Tickets
            </Link>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
}
