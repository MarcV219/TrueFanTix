import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Privacy Policy | TrueFanTix",
  description: "How TrueFanTix handles your personal information and protects your privacy.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[#064a93] text-white py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white">Privacy Policy</h1>
          <p className="text-xl text-gray-100">Your privacy matters to us</p>
        </div>
      </section>

      {/* Content */}
      <section className="py-12 px-4 flex-1">
        <div className="max-w-4xl mx-auto space-y-8">
          
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Our Commitment
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              We collect only necessary data to provide our services. We do not sell user data. 
              We follow applicable Canadian and U.S. privacy regulations.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              What We Collect
            </h2>
            <div className="space-y-4 text-gray-600 dark:text-gray-400">
              <p className="leading-relaxed">
                <strong className="text-gray-900 dark:text-white">To Process Payments:</strong> We collect 
                payment information, billing address, and transaction history. Payment details are handled 
                securely by Stripe; we do not store full card numbers on our servers.
              </p>
              <p className="leading-relaxed">
                <strong className="text-gray-900 dark:text-white">To Verify Identities:</strong> We may 
                collect identification documents and contact information to verify your identity and 
                prevent fraud.
              </p>
              <p className="leading-relaxed">
                <strong className="text-gray-900 dark:text-white">To Prevent Fraud:</strong> We collect 
                device information, IP addresses, and usage patterns to detect and prevent fraudulent activity.
              </p>
              <p className="leading-relaxed">
                <strong className="text-gray-900 dark:text-white">To Deliver Notifications:</strong> We 
                collect email addresses and phone numbers to send transaction confirmations, updates, 
                and important account information.
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              What We Don&apos;t Do
            </h2>
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
              <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                <strong>We do not sell user data.</strong> Your personal information is used solely 
                to provide and improve our services. We do not share your data with third parties for 
                marketing purposes.
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Data Security
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
              We implement industry-standard security measures to protect your data:
            </p>
            <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-2">
              <li>Encryption of sensitive data in transit and at rest</li>
              <li>Secure password hashing (bcrypt)</li>
              <li>Regular security assessments</li>
              <li>Access controls and authentication</li>
              <li>PCI DSS compliant payment processing via Stripe</li>
            </ul>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Your Rights
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
              Depending on your location, you may have the right to:
            </p>
            <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-2">
              <li>Access your personal information</li>
              <li>Correct inaccurate information</li>
              <li>Request deletion of your data</li>
              <li>Opt out of marketing communications</li>
              <li>Export your data</li>
            </ul>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Legal Compliance
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              We follow applicable Canadian and U.S. privacy regulations including PIPEDA (Canada) 
              and applicable state privacy laws in the United States. We are committed to transparency 
              and will notify users of any significant changes to this policy.
            </p>
          </div>

          {/* Navigation Buttons */}
          <div className="mt-12 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/pricing-policy"
              className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center"
            >
              Next: Pricing & Fee Policy →
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
