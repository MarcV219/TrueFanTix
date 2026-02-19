import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Community Guidelines | TrueFanTix",
  description: "Community guidelines for the TrueFanTix forum and platform.",
};

export default function CommunityGuidelinesPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[#064a93] text-white py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white">Community Guidelines</h1>
          <p className="text-xl text-gray-100">Help us build a positive community for fans</p>
        </div>
      </section>

      {/* Content */}
      <section className="py-12 px-4 flex-1">
        <div className="max-w-4xl mx-auto space-y-8">
          
          {/* Overview */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              The TrueFanTix Forum
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              The TrueFanTix forum is open to all registered users. It&apos;s a place for fans to 
              connect, discuss events, share reviews, and talk about their entertainment interests.
            </p>
          </div>

          {/* Allowed Content */}
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-8">
            <h2 className="text-2xl font-bold text-green-900 dark:text-green-300 mb-6">
              ✅ Allowed Content
            </h2>

            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="text-2xl">🎭</div>
                <div>
                  <h3 className="font-semibold text-green-900 dark:text-green-300 mb-1">Event Discussion</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    Talk about upcoming concerts, shows, games, and other live events. Share excitement, 
                    ask questions, and connect with fellow fans.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="text-2xl">⭐</div>
                <div>
                  <h3 className="font-semibold text-green-900 dark:text-green-300 mb-1">Reviews</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    Share your experiences with sellers, venues, and events. Honest reviews help 
                    build trust in our community.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="text-2xl">🎸</div>
                <div>
                  <h3 className="font-semibold text-green-900 dark:text-green-300 mb-1">Entertainment Interests</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    Discuss your favorite artists, teams, bands, and genres. Find people with 
                    similar interests.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Not Allowed */}
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-8">
            <h2 className="text-2xl font-bold text-red-900 dark:text-red-300 mb-6">
              ❌ Not Allowed
            </h2>

            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="text-2xl">🏛️</div>
                <div>
                  <h3 className="font-semibold text-red-900 dark:text-red-300 mb-1">Politics</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    Political discussions are not permitted. This is a space for fans to connect 
                    over shared entertainment interests. There are plenty of other Social Media Communities to discuss these issues.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="text-2xl">🙏</div>
                <div>
                  <h3 className="font-semibold text-red-900 dark:text-red-300 mb-1">Religion</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    Religious discussions are not allowed. Please keep conversations focused on 
                    events and entertainment. All people are welcomed here, no matter your beliefs.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="text-2xl">🚫</div>
                <div>
                  <h3 className="font-semibold text-red-900 dark:text-red-300 mb-1">Race-Based Discussion</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    Discussions based on race, ethnicity, or national origin are not permitted. All people are welcomed here.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="text-2xl">😤</div>
                <div>
                  <h3 className="font-semibold text-red-900 dark:text-red-300 mb-1">Harassment or Abuse</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    Any form of harassment, bullying, abusive language, or personal attacks will 
                    not be tolerated.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="text-2xl">💬</div>
                <div>
                  <h3 className="font-semibold text-red-900 dark:text-red-300 mb-1">Off-Platform Transaction Attempts</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    Attempting to conduct ticket transactions outside of TrueFanTix is strictly 
                    prohibited and may result in account suspension or termination.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Moderation */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Moderation
            </h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
              Moderation may remove content that violates these guidelines. Repeated violations 
              may result in temporary or permanent suspension of forum privileges or account 
              termination.
            </p>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              If you see content that violates these guidelines, please report it to our support team.
            </p>
          </div>

          {/* Be Kind */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-8 text-center">
            <div className="text-4xl mb-4">💙</div>
            <h2 className="text-2xl font-bold text-blue-900 dark:text-blue-300 mb-4">
              Be Kind, Be a Fan
            </h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              We&apos;re all here because we love live events. Let&apos;s keep this community 
              welcoming, positive, and focused on the shared experiences that bring us together.
            </p>
          </div>

          {/* Navigation Buttons */}
          <div className="mt-12 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/about/our-story"
              className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center"
            >
              Next: Our Story →
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
