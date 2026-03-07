export const metadata = {
  title: "Accessibility | TrueFanTix",
};

export default function AccessibilityPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold mb-4">Accessibility</h1>
      <p className="text-[var(--foreground)]/80 leading-relaxed">
        TrueFanTix is committed to providing an accessible experience for all users. If you
        encounter any accessibility barriers, please contact us at{" "}
        <a className="underline" href="mailto:support@truefantix.com">
          support@truefantix.com
        </a>
        .
      </p>
    </main>
  );
}
