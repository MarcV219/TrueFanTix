import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Payments – Frequently Asked Questions | TrueFanTix",
  description: "Learn about payments on TrueFanTix including secure processing via Stripe Connect.",
};

export default function PaymentsFAQPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[#064a93] py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4" style={{ color: "#e6edf5" }}>Payments</h1>
          <p className="text-xl" style={{ color: "#e6edf5" }}>Frequently Asked Questions</p>
        </div>
      </section>

      {/* FAQ Content */}
      <section className="py-12 px-4 flex-1">
        <div className="max-w-4xl mx-auto space-y-6">
          
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              How does TrueFanTix process payments?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              TrueFanTix uses secure payment processing via{" "}
              <a href="https://stripe.com/connect" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                Stripe Connect Express
              </a>.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              How do buyers pay?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              Buyers pay securely by card through Stripe&apos;s secure payment system.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              How do sellers receive payouts?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              Seller payouts are handled automatically through Stripe Connect once the transaction 
              is complete and any dispute window has passed.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              When are funds split?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              Funds are split at checkout. The seller receives their portion and the admin fee 
              is separated to cover platform costs.
            </p>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-8">
            <h2 className="text-xl font-bold text-blue-900 dark:text-blue-300 mb-4">
              What does the admin fee cover?
            </h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              The admin fee (8.75%) covers processing costs including payment gateway fees, 
              escrow services, platform maintenance, and dispute resolution systems. Most of 
              the admin fee goes toward paying for the services required to run the site securely.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              What currencies are supported?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              We maintain separate CAD and USD accounts. Payments are made in their original 
              currency to ensure transparency and avoid conversion fees.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Is my payment information secure?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              Yes. We never store your full card details on our servers. All payment information 
              is handled securely by Stripe, which is PCI DSS compliant.
            </p>
          </div>

        </div>

        {/* Navigation Buttons */}
        <div className="max-w-4xl mx-auto mt-12 flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/faq/refunds"
            className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center"
          >
            Next: Refunds →
          </Link>
          <Link
            href="/tickets"
            className="inline-block bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white px-8 py-3 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition text-center"
          >
            Browse Tickets
          </Link>
        </div>
      </section>
      <Footer />
    </div>
  );
}
