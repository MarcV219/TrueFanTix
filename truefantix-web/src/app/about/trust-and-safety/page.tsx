import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Trust & Safety | TrueFanTix",
  description: "Learn about TrueFanTix's trust and safety measures including escrow, verification, and dispute resolution.",
};

export default function TrustAndSafetyPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[#064a93] py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4" style={{ color: "#e6edf5" }}>Trust & Safety</h1>
          <p className="text-xl" style={{ color: "#e6edf5" }}>
            Trust is built into the platform
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-12 px-4 flex-1">
        <div className="max-w-4xl mx-auto">
          {/* Mandatory Escrow */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 md:p-12 mb-8">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl">
                🔒
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Mandatory Escrow
              </h2>
            </div>

            <p className="text-gray-600 dark:text-gray-400 mb-6">
              All tickets must be transferred into TrueFanTix escrow before listing. This prevents:
            </p>

            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <h3 className="font-semibold text-red-900 dark:text-red-300 mb-2">❌ Duplicate sales</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Tickets can&apos;t be sold multiple times
                </p>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <h3 className="font-semibold text-red-900 dark:text-red-300 mb-2">❌ Fake listings</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Sellers must prove they have the tickets
                </p>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <h3 className="font-semibold text-red-900 dark:text-red-300 mb-2">❌ Off-platform manipulation</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  All transactions go through our secure system
                </p>
              </div>
            </div>
          </div>

          {/* Verification */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 md:p-12 mb-8">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-green-600 text-white rounded-full flex items-center justify-center text-2xl">
                ✅
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Verification
              </h2>
            </div>

            <p className="text-gray-600 dark:text-gray-400 mb-6">
              We use tiered verification:
            </p>

            <div className="space-y-4">
              <div className="flex items-start gap-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">
                  1
                </div>
                <div>
                  <h3 className="font-semibold text-green-900 dark:text-green-300 mb-1">
                    Primary seller API integrations
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Where available, we connect directly to official ticket providers
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">
                  2
                </div>
                <div>
                  <h3 className="font-semibold text-green-900 dark:text-green-300 mb-1">
                    Automated upload validation
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Our system verifies ticket authenticity automatically
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">
                  3
                </div>
                <div>
                  <h3 className="font-semibold text-green-900 dark:text-green-300 mb-1">
                    Manual review for edge cases
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Our team reviews complex situations
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Seller Reputation */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 md:p-12 mb-8">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-amber-600 text-white rounded-full flex items-center justify-center text-2xl">
                ⭐
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Seller Reputation
              </h2>
            </div>

            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Each seller builds a public reputation score based on:
            </p>

            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-center">
                <div className="text-3xl mb-2">💬</div>
                <h3 className="font-semibold text-amber-900 dark:text-amber-300 mb-1">Buyer reviews</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Feedback from every transaction
                </p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-center">
                <div className="text-3xl mb-2">✓</div>
                <h3 className="font-semibold text-amber-900 dark:text-amber-300 mb-1">Successful deliveries</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Track record of completed sales
                </p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-center">
                <div className="text-3xl mb-2">📊</div>
                <h3 className="font-semibold text-amber-900 dark:text-amber-300 mb-1">Dispute history</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  How issues were resolved
                </p>
              </div>
            </div>
          </div>

          {/* Dispute Resolution */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 md:p-12">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-purple-600 text-white rounded-full flex items-center justify-center text-2xl">
                ⚖️
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Dispute Resolution
              </h2>
            </div>

            <p className="text-gray-600 dark:text-gray-400 mb-6">
              If a buyer opens a dispute:
            </p>

            <div className="space-y-4">
              <div className="flex items-center gap-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                <div className="w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">
                  1
                </div>
                <p className="text-gray-700 dark:text-gray-300">
                  <strong>Seller payout is paused</strong> - No money changes hands until resolved
                </p>
              </div>

              <div className="flex items-center gap-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                <div className="w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">
                  2
                </div>
                <p className="text-gray-700 dark:text-gray-300">
                  <strong>Evidence is reviewed</strong> - Both parties can submit documentation
                </p>
              </div>

              <div className="flex items-center gap-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                <div className="w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">
                  3
                </div>
                <p className="text-gray-700 dark:text-gray-300">
                  <strong>Admin resolves fairly</strong> - Impartial decision based on evidence
                </p>
              </div>
            </div>

            <div className="mt-8 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-6">
              <p className="text-gray-600 dark:text-gray-400">
                We combine <strong>automation</strong> with <strong>human oversight</strong> to maintain marketplace integrity.
              </p>
            </div>
          </div>

          {/* Navigation Buttons */}
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/faq"
              className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center"
            >
              Next: FAQ →
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
