// src/app/forum/page.tsx
import Link from "next/link";
import { headers } from "next/headers";
import Footer from "@/components/Footer";

type ForumAuthor = {
  id: string;
  displayName: string | null;
  firstName: string;
  lastName: string;
};

type ForumThread = {
  id: string;
  title: string;
  topicType: string;
  topic: string | null;
  createdAt: string;
  author: ForumAuthor;
  _count: {
    posts: number;
  };
};

async function getBaseUrlFromHeaders() {
  const h = await headers();

  // Prefer forwarded headers (common in proxies), fall back to host
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host");

  if (!host) return null;
  return `${proto}://${host}`;
}

async function getThreads(): Promise<ForumThread[]> {
  const baseUrl = await getBaseUrlFromHeaders();
  if (!baseUrl) {
    throw new Error("Unable to determine base URL from request headers.");
  }

  const res = await fetch(`${baseUrl}/api/forum/threads`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Failed to load forum threads");
  }

  const data = await res.json();
  return data.items ?? [];
}

export const metadata = {
  title: "Community Forum | TrueFanTix",
  description: "Discuss events, artists, teams, and shows with other fans on the TrueFanTix Community Forum.",
};

export default async function ForumPage() {
  const threads = await getThreads();

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Community Forum</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Discuss events, artists, teams, and shows with other fans.
          </p>
        </header>

        <div className="mb-6 flex justify-between items-center">
          <Link 
            href="/forum/new"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            + New Discussion
          </Link>
        </div>

        {threads.length === 0 ? (
          <p className="text-gray-600 dark:text-gray-400">No discussions yet.</p>
        ) : (
          <ul className="space-y-4">
            {threads.map((thread) => {
              const authorName =
                thread.author.displayName ??
                `${thread.author.firstName} ${thread.author.lastName}`;

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
                    <span>{thread._count.posts} posts</span>
                    <span>by {authorName}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

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
