import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Selling Tickets – Frequently Asked Questions | TrueFanTix",
  description: "Frequently asked questions about selling tickets on TrueFanTix.",
};

export default function SellingFAQPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[#064a93] text-white py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white">Selling Tickets</h1>
          <p className="text-xl text-gray-100">Frequently Asked Questions</p>
        </div>
      </section>

      {/* FAQ Content */}
      <section className="py-12 px-4 flex-1">
        <div className="max-w-4xl mx-auto space-y-6">
          
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Why should I sell tickets to events that are sold out on this site?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              By selling tickets to sold out events on this site, you gain access to purchase tickets 
              to events that are sold out at or below face value. TrueFanTix is designed to be a 
              community that benefits actual fans.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Why should I sell tickets to events that aren&apos;t sold out on this site?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              The fees paid by the buyer on this site are very low compared to other secondary market 
              sites which benefits the purchaser while providing the seller 100% of their list price. 
              Many other sites charge fees to the seller, but this site does not.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Do I pay fees to sell tickets?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              No the seller doesn&apos;t pay any fees to sell on this site. Sellers receive 100% of 
              their listed ticket price.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Can I list above face value?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              No. Tickets must be listed at or below face value but includes any original fees paid 
              by the seller (i.e. Ticketmaster fees). The TrueFanTix system is meant to be fair. 
              Our aim is to keep sellers whole and rewarding them with access to sold out events 
              at face value prices.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              When should I sell my tickets for less than face value?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              If an event is not sold out, you may want to consider selling your tickets for below 
              face value as an incentive to purchasers to buy your tickets instead of someone else&apos;s.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              When do I get paid?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              Payouts are released after successful delivery confirmation and expiration of any dispute window.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              What happens if a buyer disputes?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              Payout is temporarily paused while the case is reviewed. See our{" "}
              <Link href="/about/trust-and-safety" className="text-blue-600 hover:underline">Trust & Safety</Link>{" "}
              page for more details on dispute resolution.
            </p>
          </div>

        </div>

        {/* Navigation Buttons */}
        <div className="max-w-4xl mx-auto mt-12 flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/faq/access-tokens"
            className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center"
          >
            Next: Access Tokens →
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
