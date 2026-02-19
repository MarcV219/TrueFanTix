// src/app/forum/page.tsx
import Link from "next/link";
import { headers } from "next/headers";
import Footer from "@/components/Footer";

async function getBaseUrlFromHeaders() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  return `${proto}://${host}`;
}

async function getThreads() {
  const baseUrl = await getBaseUrlFromHeaders();
  if (!baseUrl) return [];

  try {
    const res = await fetch(`${baseUrl}/api/forum/threads`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.items ?? [];
  } catch {
    return [];
  }
}

async function getCurrentUser() {
  const baseUrl = await getBaseUrlFromHeaders();
  if (!baseUrl) return null;

  try {
    const h = await headers();
    const cookie = h.get("cookie") ?? "";
    
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      cache: "no-store",
      headers: cookie ? { cookie } : undefined,
    });
    
    if (!res.ok) return null;
    const data = await res.json();
    return data.user ?? null;
  } catch {
    return null;
  }
}

export const metadata = {
  title: "Community Forum | TrueFanTix",
  description: "Discuss events, artists, teams, and shows with other fans on the TrueFanTix Community Forum.",
};

export default async function ForumPage() {
  const [threads, user] = await Promise.all([getThreads(), getCurrentUser()]);
  const isLoggedIn = !!user;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8">
        {/* Hero */}
        <section className="bg-[#064a93] py-16 rounded-xl mb-8">
          <div className="max-w-4xl mx-auto px-4 text-center">
            <h1 className="text-3xl font-bold mb-4" style={{ color: '#e6edf5' }}>Community Forum</h1>
            <p className="text-xl" style={{ color: '#e6edf5' }}>
              Discuss events, artists, teams, and shows with other fans.
            </p>
          </div>
        </section>

        {/* Action Bar */}
        <div className="mb-6 flex justify-between items-center">
          {isLoggedIn ? (
            <Link 
              href="/forum/new"
              className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              + New Discussion
            </Link>
          ) : (
            <div className="flex items-center gap-4">
              <span className="text-gray-600 dark:text-gray-400">
                Sign in to participate in discussions
              </span>
              <Link 
                href="/login?redirect=/forum"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition"
              >
                Sign In
              </Link>
            </div>
          )}
        </div>

        {/* Threads List */}
        {threads.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl p-8 text-center border border-gray-200 dark:border-gray-700">
            <p className="text-gray-600 dark:text-gray-400 mb-4">No discussions yet.</p>
            {isLoggedIn && (
              <Link 
                href="/forum/new"
                className="text-blue-600 hover:underline"
              >
                Start the first discussion →
              </Link>
            )}
          </div>
        ) : (
          <ul className="space-y-4">
            {threads.map((thread: any) => {
              const authorName =
                thread.author?.displayName ??
                `${thread.author?.firstName ?? ''} ${thread.author?.lastName ?? ''}`.trim() ||
                'Unknown';

              return (
                <li
                  key={thread.id}
                  className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition"
                >
                  <Link
                    href={`/forum/threads/${thread.id}`}
                    className="text-xl font-semibold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition"
                  >
                    {thread.title}
                  </Link>

                  <div className="mt-2 text-sm text-gray-500 dark:text-gray-400 flex flex-wrap gap-2">
                    <span className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">{thread.topicType}</span>
                    {thread.topic && <span className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">{thread.topic}</span>}
                    <span>{thread._count?.posts ?? 0} posts</span>
                    <span>by {authorName}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Login Prompt for Guests */}
        {!isLoggedIn && threads.length > 0 && (
          <div className="mt-8 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-6 text-center">
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              Want to join the conversation? Sign in to reply to posts and create new discussions.
            </p>
            <Link
              href="/login?redirect=/forum"
              className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              Sign In to Participate
            </Link>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-8 flex justify-center gap-4">
          <Link
            href="/about/how-it-works"
            className="inline-block bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white px-6 py-3 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition"
          >
            Next: How It Works →
          </Link>
          <Link
            href="/tickets"
            className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            Browse Tickets
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
