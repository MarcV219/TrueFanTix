import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Why Face Value | TrueFanTix",
  description: "Learn why TrueFanTix enforces tickets at or below face value - creating fairness for real fans.",
};

export default function WhyFaceValuePage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[#064a93] py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4" style={{ color: "#e6edf5" }}>Why Face Value</h1>
          <p className="text-xl" style={{ color: "#e6edf5" }}>
            One core rule: Tickets at or below face value
          </p>
        </div>
      </section>

      {/* Core Rule */}
      <section className="py-12 px-4 flex-1">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 md:p-12 mb-8">
            <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-600 p-6 mb-8">
              <p className="text-lg font-semibold text-blue-900 dark:text-blue-300">
                TrueFanTix enforces one core rule: Tickets must be listed at or below face value 
                (including original fees).
              </p>
            </div>

            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              Why?
            </h2>

            <p className="text-gray-600 dark:text-gray-400 text-lg leading-relaxed mb-8">
              Because live events are experiences for real fans, not commodities for price manipulation.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              By enforcing face value:
            </h2>

            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
                <div className="text-3xl mb-3">🎯</div>
                <h3 className="font-semibold text-green-900 dark:text-green-300 mb-2">
                  We reduce speculative buying (scalping)
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  No more buying tickets just to resell at higher prices.
                </p>
              </div>

              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
                <div className="text-3xl mb-3">👥</div>
                <h3 className="font-semibold text-green-900 dark:text-green-300 mb-2">
                  We serve genuine fans
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Tickets go to people who actually want to attend.
                </p>
              </div>

              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
                <div className="text-3xl mb-3">🤝</div>
                <h3 className="font-semibold text-green-900 dark:text-green-300 mb-2">
                  We create a community
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  A place for like-minded individuals who love live events.
                </p>
              </div>

              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
                <div className="text-3xl mb-3">⚖️</div>
                <h3 className="font-semibold text-green-900 dark:text-green-300 mb-2">
                  Alternative to buy low, sell high
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Breaking the traditional resale model.
                </p>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6 mb-8">
              <div className="text-3xl mb-3">💙</div>
              <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">
                We build long-term trust
              </h3>
              <p className="text-gray-700 dark:text-gray-300">
                Through you and with you.
              </p>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700 pt-8">
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-6">
                This is not about limiting sellers. It&apos;s about creating a place for like minded 
                fans that are tired of the way the current system is failing them. We prioritize 
                fairness and access over exploitation.
              </p>
            </div>
          </div>

          {/* Price Transparency */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 md:p-12">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              Price Transparency
            </h2>

            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Transparency badges clearly display:
            </p>

            <div className="flex flex-wrap gap-4 mb-8">
              <span className="inline-flex items-center gap-2 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-4 py-2 rounded-full font-semibold">
                <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                At Face Value
              </span>
              <span className="inline-flex items-center gap-2 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-4 py-2 rounded-full font-semibold">
                <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
                Below Face Value
              </span>
            </div>

            <p className="text-gray-600 dark:text-gray-400">
              No guessing. No hidden markups.
            </p>
          </div>

          {/* Navigation Buttons */}
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/about/trust-and-safety"
              className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center"
            >
              Next: Trust & Safety →
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
