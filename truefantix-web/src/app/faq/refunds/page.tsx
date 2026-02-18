import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Refunds – Frequently Asked Questions | TrueFanTix",
  description: "Learn about the refund policy on TrueFanTix including event cancellations and dispute resolution.",
};

export default function RefundsFAQPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[var(--tft-navy)] text-white py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Refunds</h1>
          <p className="text-xl text-gray-300">Frequently Asked Questions</p>
        </div>
      </section>

      {/* FAQ Content */}
      <section className="py-12 px-4 flex-1">
        <div className="max-w-4xl mx-auto space-y-6">
          
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              What is the refund policy?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              Refunds depend on the specific situation. We handle refunds differently based on 
              whether the event was cancelled, postponed, or if there was a delivery issue.
            </p>
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-8">
            <h2 className="text-xl font-bold text-amber-900 dark:text-amber-300 mb-4">
              Event Cancellation or Postponement
            </h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              If an event is officially canceled or postponed, buyers would seek refunds from 
              the official event provider (the primary ticket seller like Ticketmaster, etc.). 
              TrueFanTix facilitates communication but the refund ultimately comes from the 
              original ticket issuer.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Delivery Issues
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
              If tickets fail verification or delivery:
            </p>
            <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-2">
              <li>A dispute can be opened by the buyer</li>
              <li>The case will be reviewed by our team</li>
              <li>If the seller cannot provide valid tickets, a refund will be issued</li>
            </ul>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              How do I open a dispute?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              If you encounter an issue with your ticket purchase, contact support through your 
              account page. Our dispute resolution process involves reviewing evidence from both 
              parties and making a fair determination.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              What happens during a dispute?
            </h2>
            <div className="space-y-4 text-gray-600 dark:text-gray-400">
              <p className="leading-relaxed">
                <strong className="text-gray-900 dark:text-white">1. Seller payout is paused</strong> — 
                No money changes hands until the dispute is resolved.
              </p>
              <p className="leading-relaxed">
                <strong className="text-gray-900 dark:text-white">2. Evidence is reviewed</strong> — 
                Both parties can submit documentation to support their case.
              </p>
              <p className="leading-relaxed">
                <strong className="text-gray-900 dark:text-white">3. Admin resolves fairly</strong> — 
                An impartial decision is made based on the evidence provided.
              </p>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-8">
            <h2 className="text-xl font-bold text-blue-900 dark:text-blue-300 mb-4">
              Full Policy
            </h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              All refunds follow the platform&apos;s formal{" "}
              <Link href="/terms" className="text-blue-600 hover:underline">Dispute & Refund Policy</Link>.
              For detailed information about refund eligibility and procedures, please review our 
              Terms of Service.
            </p>
          </div>

        </div>

        {/* Navigation Buttons */}
        <div className="max-w-4xl mx-auto mt-12 flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/faq"
            className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center"
          >
            ← Back to All FAQs
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
