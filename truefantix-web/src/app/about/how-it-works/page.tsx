import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata = {
  title: "How it Works | TrueFanTix",
  description: "Learn how TrueFanTix works for buyers and sellers. Fair ticket marketplace at or below face value.",
};

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[var(--tft-navy)] text-white py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">How it Works</h1>
          <p className="text-xl text-gray-300">
            TrueFanTix is different from traditional resale platforms
          </p>
        </div>
      </section>

      {/* For Sellers */}
      <section className="py-12 px-4 flex-1">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 md:p-12 mb-8">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-14 h-14 bg-green-600 text-white rounded-full flex items-center justify-center text-3xl">
                💰
              </div>
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
                For Sellers
              </h2>
            </div>

            <div className="space-y-6">
              <div className="flex items-start gap-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
                <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0">
                  1
                </div>
                <div>
                  <h3 className="font-semibold text-green-900 dark:text-green-300 mb-1 text-lg">
                    List tickets at or below face value
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    Set your price at or below what you originally paid (including fees)
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
                <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0">
                  2
                </div>
                <div>
                  <h3 className="font-semibold text-green-900 dark:text-green-300 mb-1 text-lg">
                    Transfer tickets into secure escrow
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    Your tickets are held safely until the sale is complete
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
                <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0">
                  3
                </div>
                <div>
                  <h3 className="font-semibold text-green-900 dark:text-green-300 mb-1 text-lg">
                    Once sold and delivered successfully, receive 100% of your ticket price
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    No seller fees - you keep the full amount
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
                <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0">
                  4
                </div>
                <div>
                  <h3 className="font-semibold text-green-900 dark:text-green-300 mb-1 text-lg">
                    Earn access tokens for sold out events
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    If tickets sold were for a sold out event, you receive 100% of your ticket price and you earn access tokens to purchase an equivalent amount of tickets to any other sold out events of your choosing, whenever you choose to use them. The access tokens never expire. Your access token balance only gets drawn down as you use them to purchase tickets to sold out events.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
                <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0">
                  5
                </div>
                <div>
                  <h3 className="font-semibold text-green-900 dark:text-green-300 mb-1 text-lg">
                    Non-sold out events
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    If tickets sold were for an event that was not sold out, you receive 100% of your ticket price.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
                <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0">
                  6
                </div>
                <div>
                  <h3 className="font-semibold text-green-900 dark:text-green-300 mb-1 text-lg">
                    Why sell tickets below face value?
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    If the event isn&apos;t sold out, it makes it less likely that buyers will choose your tickets over the original seller unless you reduce your price. Secondary Ticket Market Places charge fees for selling tickets. We believe, we have the lowest admin fees out there, and the seller doesn&apos;t pay them, the buyer does.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
                <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0">
                  7
                </div>
                <div>
                  <h3 className="font-semibold text-green-900 dark:text-green-300 mb-1 text-lg">
                    Build reputation through successful transactions
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    Each sale builds your reputation as a trusted seller
                  </p>
                </div>
              </div>
            </div>

            {/* Standout statement */}
            <div className="mt-8 bg-[var(--tft-navy)] text-white rounded-xl p-6 text-center">
              <p className="text-xl font-semibold">
                There are no hidden seller fees. Sellers are kept whole.
              </p>
            </div>
          </div>

          {/* For Buyers */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 md:p-12 mb-8">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-14 h-14 bg-blue-600 text-white rounded-full flex items-center justify-center text-3xl">
                🎟️
              </div>
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
                For Buyers
              </h2>
            </div>

            <div className="space-y-6">
              <div className="flex items-start gap-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
                <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0">
                  1
                </div>
                <div>
                  <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-1 text-lg">
                    Browse verified listings
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    All tickets are verified and held in escrow before listing
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
                <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0">
                  2
                </div>
                <div>
                  <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-1 text-lg">
                    All tickets are priced at or below face value
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    You&apos;ll never pay more than the original buyer
                  </p>
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-6">
                <h3 className="font-semibold text-amber-900 dark:text-amber-300 mb-3 text-lg">
                  For Events that Aren&apos;t Sold Out:
                </h3>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-amber-600 text-white rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0">
                    3
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white mb-1">
                      Anyone can purchase tickets to any event that is not sold out.
                    </h4>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
                <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0">
                  4
                </div>
                <div>
                  <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-1 text-lg">
                    For Sold Out Events Only
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    Only buyers with access tokens will have access to purchase tickets to sold out events. To earn access tokens to sold out events, you must first sell tickets to sold out events. Each sold out event ticket sold earns one access token. Each access token provides access to purchase 1 sold out event ticket.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
                <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0">
                  5
                </div>
                <div>
                  <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-1 text-lg">
                    Pay ticket price + 8.75% admin fee + applicable taxes
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    Most of the Admin fee goes toward paying for the services required to run the site.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
                <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0">
                  6
                </div>
                <div>
                  <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-1 text-lg">
                    Receive tickets securely via escrow transfer
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    Tickets are transferred to you once payment is confirmed
                  </p>
                </div>
              </div>
            </div>

            {/* Standout statement */}
            <div className="mt-8 bg-blue-600 text-white rounded-xl p-6 text-center">
              <p className="text-lg font-semibold">
                Every transaction is protected by verification, duplicate prevention, and dispute resolution workflows.
              </p>
            </div>
          </div>

          {/* Navigation Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/about/why-face-value"
              className="inline-block bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white px-8 py-3 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition text-center"
            >
              Next: Why Face Value →
            </Link>
            <Link
              href="/tickets"
              className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center"
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
