import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Access Tokens – Frequently Asked Questions | TrueFanTix",
  description: "Learn how access tokens work on TrueFanTix for purchasing sold out event tickets.",
};

export default function AccessTokensFAQPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[var(--tft-navy)] text-white py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Access Tokens</h1>
          <p className="text-xl text-gray-300">Frequently Asked Questions</p>
        </div>
      </section>

      {/* FAQ Content */}
      <section className="py-12 px-4 flex-1">
        <div className="max-w-4xl mx-auto space-y-6">
          
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-8">
            <h2 className="text-xl font-bold text-blue-900 dark:text-blue-300 mb-4">
              What are access tokens?
            </h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              Buyers need access tokens to purchase tickets to sold out events. Access tokens are 
              earned by selling tickets to sold out events on the platform.
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
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              How do access tokens work?
            </h2>
            <div className="space-y-4 text-gray-600 dark:text-gray-400">
              <p className="leading-relaxed">
                <strong className="text-gray-900 dark:text-white">Earning:</strong> One access token 
                is earned with each ticket sold to a sold out event.
              </p>
              <p className="leading-relaxed">
                <strong className="text-gray-900 dark:text-white">Using:</strong> One access token 
                is used with each ticket purchased to a sold out event.
              </p>
              <p className="leading-relaxed">
                Your access tokens are tracked on this site and you can always see your access 
                token balance and transaction history on your account page.
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Do access tokens expire?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              No. They never expire. You can use them at the time of your choosing.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Can I use access tokens for any sold out event?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              Yes. It does not matter how you earned your access tokens. They can be used to access 
              purchasing of any event that is sold out.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Do I earn access tokens for selling tickets to events that aren&apos;t sold out?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              No. The idea behind TrueFanTix is to build a community for actual fans to get fair 
              access to events. We incentivize sellers to sell their tickets to sold out events 
              within this community by rewarding them with access tokens.
            </p>
          </div>

        </div>

        {/* Navigation Buttons */}
        <div className="max-w-4xl mx-auto mt-12 flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/faq/payments"
            className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center"
          >
            Next: Payments →
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
