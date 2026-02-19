import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Pricing and Fee Policy | TrueFanTix",
  description: "TrueFanTix pricing and fee policy - transparent pricing with no hidden charges.",
};

export default function PricingPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[#064a93] py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4" style={{ color: "#e6edf5" }}>Pricing and Fee Policy</h1>
          <p className="text-xl" style={{ color: "#e6edf5" }}>Transparent pricing with no hidden charges</p>
        </div>
      </section>

      {/* Content */}
      <section className="py-12 px-4 flex-1">
        <div className="max-w-4xl mx-auto space-y-8">
          
          {/* Core Policy */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6 mb-6">
              <h2 className="text-xl font-bold text-green-900 dark:text-green-300 mb-2">
                Our Commitment to Transparency
              </h2>
              <p className="text-gray-700 dark:text-gray-300">
                Transparency is mandatory at TrueFanTix. No hidden charges, ever.
              </p>
            </div>

            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-green-600 text-white rounded-full flex items-center justify-center text-xl flex-shrink-0">
                  💯
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                    Sellers Receive 100% of Ticket Price
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    When you list a ticket for $100, you receive $100. No seller fees, no hidden deductions.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center text-xl flex-shrink-0">
                  🧾
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                    Buyers Pay 8.75% Admin Fee
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    The buyer pays the ticket price plus an 8.75% admin fee. This covers payment processing, 
                    escrow services, platform maintenance, and dispute resolution.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-amber-600 text-white rounded-full flex items-center justify-center text-xl flex-shrink-0">
                  🏛️
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                    Taxes Calculated at Checkout
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    Applicable taxes are calculated and displayed clearly during checkout based on your location.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Fee Breakdown */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              Example Transaction
            </h2>
            
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-6">
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Ticket Price</span>
                  <span className="font-semibold text-gray-900 dark:text-white">$100.00</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Admin Fee (8.75%)</span>
                  <span className="font-semibold text-gray-900 dark:text-white">$8.75</span>
                </div>
                <div className="border-t border-gray-200 dark:border-gray-600 pt-3 flex justify-between">
                  <span className="font-semibold text-gray-900 dark:text-white">Buyer Pays</span>
                  <span className="font-bold text-blue-600">$108.75</span>
                </div>
                <div className="flex justify-between text-green-600">
                  <span className="font-semibold">Seller Receives</span>
                  <span className="font-bold">$100.00</span>
                </div>
              </div>
            </div>

            <div className="mt-6 text-gray-600 dark:text-gray-400 text-sm">
              <p>Note: Applicable taxes will be added at checkout where required by law.</p>
            </div>
          </div>

          {/* What the Fee Covers */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              What the Admin Fee Covers
            </h2>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">🔒 Escrow Services</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Secure ticket holding and verification
                </p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">💳 Payment Processing</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Stripe Connect fees and transaction costs
                </p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">⚖️ Dispute Resolution</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Human oversight for conflict resolution
                </p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">🛠️ Platform Maintenance</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Server costs, security, and development
                </p>
              </div>
            </div>
          </div>

          {/* Comparison */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              How We Compare
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-3 px-4 text-gray-900 dark:text-white">Platform</th>
                    <th className="text-center py-3 px-4 text-gray-900 dark:text-white">Seller Fee</th>
                    <th className="text-center py-3 px-4 text-gray-900 dark:text-white">Buyer Fee</th>
                    <th className="text-center py-3 px-4 text-gray-900 dark:text-white">Face Value Rule</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600 dark:text-gray-400">
                  <tr className="bg-green-50 dark:bg-green-900/10 border-b border-gray-200 dark:border-gray-700">
                    <td className="py-3 px-4 font-semibold text-green-900 dark:text-green-300">TrueFanTix</td>
                    <td className="text-center py-3 px-4 text-green-600 font-semibold">0%</td>
                    <td className="text-center py-3 px-4">8.75%</td>
                    <td className="text-center py-3 px-4 text-green-600">✓ Enforced</td>
                  </tr>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <td className="py-3 px-4">Typical Secondary Market</td>
                    <td className="text-center py-3 px-4">10-15%</td>
                    <td className="text-center py-3 px-4">10-20%</td>
                    <td className="text-center py-3 px-4 text-red-500">✗ No limit</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Navigation Buttons */}
          <div className="mt-12 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/community-guidelines"
              className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center"
            >
              Next: Community Guidelines →
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
