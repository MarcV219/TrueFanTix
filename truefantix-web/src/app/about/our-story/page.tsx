import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Our Story | TrueFanTix",
  description: "The story behind TrueFanTix - a fan-first ticket marketplace built by fans, for fans.",
};

export default function OurStoryPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[#064a93] text-white py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white">Our Story</h1>
          <p className="text-xl text-gray-100">
            Built by a fan, for fans
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-12 px-4 flex-1">
        <div className="max-w-3xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 md:p-12">
          <div className="prose dark:prose-invert max-w-none">
            <p className="text-lg leading-relaxed text-gray-700 dark:text-gray-300 mb-6">
              TrueFanTix was built on a simple belief: Fans shouldn&apos;t be priced out of the events they love. 
            </p>
            <p className="text-lg leading-relaxed text-gray-700 dark:text-gray-300 mb-6 font-semibold">
              I built TrueFanTix because I am a fan like you.
            </p>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-6">
              Like many of you, I have watched tickets go on sale at a list price, only to see them reappear 
              minutes later on secondary sites for two, three, even four times more. I have sat in countless 
              online queues, refreshed screens, coming to the full realization that the system was never designed 
              for actual fans, it was designed for quick profit.
            </p>

            <p className="text-lg leading-relaxed text-gray-700 dark:text-gray-300 mb-6 font-semibold">
              I&apos;m part of the community that has felt the problem and wanted to do something about it.
            </p>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-6">
              I have loved attending live events since I was a teenager. I&apos;ve had so many great memories 
              over the years, some of which will last a lifetime. Everything was so much simpler back then. 
              Sure, there were usually scalpers standing outside of venues, but they didn&apos;t seem to have 
              much of an impact on our experience. Nothing like we see today.
            </p>

            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-6">
              Scalping has transformed into large-scale flipping operations that has become big business at 
              the cost of actual fans. Tickets intended for true fans are treated like commodities to be flipped. 
              Buy low, sell high. Prices have skyrocketed. The trust in the system is long gone. And the actual 
              fans, the very people these events are made for are often left out.
            </p>

            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-8">
              TrueFanTix was created to offer an alternative to the current system. There will never be any 
              scalpers here. If you&apos;re here because you&apos;ve felt the same frustration, you&apos;re not alone. 
              And you&apos;re exactly who this platform is built for.
            </p>

            <div className="border-t border-gray-200 dark:border-gray-700 pt-8 mt-8">
              <p className="font-semibold text-gray-900 dark:text-white">Marc</p>
              <p className="text-gray-600 dark:text-gray-400">Founder, TrueFanTix</p>
            </div>
          </div>

          {/* Navigation Buttons */}
          <div className="mt-12 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/about/how-it-works"
              className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center"
            >
              Next: How It Works →
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
