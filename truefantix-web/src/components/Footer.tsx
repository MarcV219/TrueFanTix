import Link from "next/link";

export default function Footer() {
  return (
    <footer className="bg-[var(--tft-navy-dark)] text-gray-100 mt-auto">
      <div className="max-w-7xl mx-auto px-6 py-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
        <div>
          <h3 className="text-2xl font-bold text-white mb-3">
            <span className="text-white">TrueFan</span>
            <span className="text-[var(--tft-teal)]">Tix</span>
          </h3>
          <p className="text-gray-300 mb-4 text-sm leading-relaxed">
            A fan-first ticket marketplace focused on fairness, transparency, and resale at or below
            face value.
          </p>
          <p className="text-sm text-gray-300/80">Built for fans — not scalpers.</p>
        </div>

        <div>
          <h4 className="font-semibold text-white mb-3">About</h4>
          <ul className="space-y-2 text-sm text-gray-300">
            <li>
              <Link href="/about/our-story" className="hover:text-white">
                Our Story
              </Link>
            </li>
            <li>
              <Link href="/about/how-it-works" className="hover:text-white">
                How It Works
              </Link>
            </li>
            <li>
              <Link href="/about/why-face-value" className="hover:text-white">
                Why Face Value
              </Link>
            </li>
            <li>
              <Link href="/about/trust-and-safety" className="hover:text-white">
                Trust & Safety
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-white mb-3">FAQ</h4>
          <ul className="space-y-2 text-sm text-gray-300">
            <li>
              <Link href="/faq/buying" className="hover:text-white">
                Buying Tickets
              </Link>
            </li>
            <li>
              <Link href="/faq/selling" className="hover:text-white">
                Selling Tickets
              </Link>
            </li>
            <li>
              <Link href="/faq/access-tokens" className="hover:text-white">
                Access Tokens
              </Link>
            </li>
            <li>
              <Link href="/faq/payments" className="hover:text-white">
                Payments
              </Link>
            </li>
            <li>
              <Link href="/faq/refunds" className="hover:text-white">
                Refunds
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-white mb-3">Legal</h4>
          <ul className="space-y-2 text-sm text-gray-300">
            <li>
              <Link href="/terms" className="hover:text-white">
                Terms of Service
              </Link>
            </li>
            <li>
              <Link href="/privacy" className="hover:text-white">
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link href="/pricing-policy" className="hover:text-white">
                Pricing & Fee Policy
              </Link>
            </li>
            <li>
              <Link href="/community-guidelines" className="hover:text-white">
                Community Guidelines
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10 mt-8">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row justify-between items-center text-sm text-gray-300/80 gap-3">
          <span>© 2026 TrueFanTix. All rights reserved.</span>
          <div className="flex flex-wrap gap-4">
            <Link href="/terms" className="hover:text-white">
              Terms of Service
            </Link>
            <Link href="/privacy" className="hover:text-white">
              Privacy Policy
            </Link>
            <Link href="/pricing-policy" className="hover:text-white">
              Pricing & Fees
            </Link>
            <Link href="/community-guidelines" className="hover:text-white">
              Community Guidelines
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
