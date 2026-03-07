export const metadata = {
  title: "Accessibility | TrueFanTix",
};

export default function AccessibilityPage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <section className="bg-[#064a93] py-12">
        <div className="max-w-5xl mx-auto px-6">
          <h1 className="text-4xl md:text-5xl font-bold mb-4" style={{ color: "#e6edf5" }}>
            Accessibility
          </h1>
          <p className="text-xl" style={{ color: "#e6edf5" }}>
            Our commitment to an inclusive, accessible experience for every fan.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-12">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8">
          <p className="text-[var(--foreground)]/80 leading-relaxed">
            TrueFanTix is committed to providing an accessible experience for all users. If you
            encounter any accessibility barriers, please contact us at{" "}
            <a className="underline" href="mailto:support@truefantix.com">
              support@truefantix.com
            </a>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
