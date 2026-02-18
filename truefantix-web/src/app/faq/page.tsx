import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata = {
  title: "FAQ | TrueFanTix",
  description: "Frequently asked questions about TrueFanTix - buying tickets, selling tickets, access tokens, payments, and refunds.",
};

export default function FAQIndexPage() {
  const faqCategories = [
    {
      title: "Buying Tickets",
      description: "Learn about purchasing tickets, access tokens for sold out events, and buyer fees.",
      href: "/faq/buying",
      icon: "🎟️",
    },
    {
      title: "Selling Tickets",
      description: "How to list tickets, when to sell below face value, payouts, and seller fees.",
      href: "/faq/selling",
      icon: "💰",
    },
    {
      title: "Access Tokens",
      description: "Understanding the access token system for sold out events.",
      href: "/faq/access-tokens",
      icon: "🎫",
    },
    {
      title: "Payments",
      description: "How payments work, Stripe Connect, currencies, and admin fees.",
      href: "/faq/payments",
      icon: "💳",
    },
    {
      title: "Refunds",
      description: "Refund policies for cancellations, delivery issues, and disputes.",
      href: "/faq/refunds",
      icon: "↩️",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[var(--tft-navy)] text-white py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Frequently Asked Questions</h1>
          <p className="text-xl text-gray-300">
            Find answers to common questions about TrueFanTix
          </p>
        </div>
      </section>

      {/* FAQ Categories */}
      <section className="py-12 px-4 flex-1">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-6">
            {faqCategories.map((category) => (
              <Link
                key={category.href}
                href={category.href}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 hover:shadow-md transition group"
              >
                <div className="text-4xl mb-4">{category.icon}</div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3 group-hover:text-blue-600 transition">
                  {category.title}
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  {category.description}
                </p>
              </Link>
            ))}
          </div>

          {/* Navigation Buttons */}
          <div className="mt-12 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/terms"
              className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center"
            >
              Next: Terms of Service →
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
