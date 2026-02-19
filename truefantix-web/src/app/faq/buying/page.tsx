import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Buying Tickets – Frequently Asked Questions | TrueFanTix",
  description: "Frequently asked questions about buying tickets on TrueFanTix.",
};

export default function BuyingFAQPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[#064a93] text-white py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white">Buying Tickets</h1>
          <p className="text-xl text-gray-100">Frequently Asked Questions</p>
        </div>
      </section>

      {/* FAQ Content */}
      <section className="py-12 px-4 flex-1">
        <div className="max-w-4xl mx-auto space-y-6">
          
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Are ticket prices fair?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              Yes, they absolutely are. Tickets can only be listed on this site at or below their original cost.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Do I need access tokens to purchase tickets to events that aren&apos;t sold out?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              No. Anyone can purchase tickets to shows that aren&apos;t sold out.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Do I need access tokens to purchase tickets to events that are sold out?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              Yes. You need to use one access token for each ticket purchased for a sold out event. 
              See <Link href="/faq/access-tokens" className="text-blue-600 hover:underline">access tokens FAQ</Link> for more information.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Are tickets guaranteed?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              Yes. All tickets are transferred into escrow before listing and must pass verification.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Will I receive the exact tickets listed?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              Yes. Listings cannot be substituted without approval.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              What fees do I pay as a buyer?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
              You pay:
            </p>
            <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-2">
              <li>Ticket price</li>
              <li>8.75% admin fee</li>
              <li>Applicable taxes</li>
            </ul>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mt-4">
              All fees are shown clearly at checkout.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Can I review a seller?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              Yes. After purchase, buyers can leave reviews and ratings.
            </p>
          </div>

        </div>

        {/* Navigation Buttons */}
        <div className="max-w-4xl mx-auto mt-12 flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/faq/selling"
            className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center"
          >
            Next: Selling Tickets →
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
