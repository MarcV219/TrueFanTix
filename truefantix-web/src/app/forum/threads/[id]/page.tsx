// src/app/forum/threads/[id]/page.tsx
import Link from "next/link";
import { headers } from "next/headers";
import ThreadRepliesClient from "./threadreplies.client";

async function getBaseUrlFromHeaders() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  return `${proto}://${host}`;
}

async function getThread(threadId: string) {
  const baseUrl = await getBaseUrlFromHeaders();
  if (!baseUrl) throw new Error("Unable to determine base URL");

  const h = await headers();
  const cookie = h.get("cookie") ?? "";

  try {
    const res = await fetch(`${baseUrl}/api/forum/threads/${encodeURIComponent(threadId)}`, {
      cache: "no-store",
      headers: cookie ? { cookie } : undefined,
    });

    if (res.status === 404) return null;
    if (!res.ok) throw new Error("Failed to load thread");

    return await res.json();
  } catch {
    return null;
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

function formatAuthor(a: any) {
  return (a?.displayName) || (`${a?.firstName ?? ''} ${a?.lastName ?? ''}`.trim()) || 'Unknown';
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [threadData, user] = await Promise.all([getThread(id), getCurrentUser()]);
  const isLoggedIn = !!user;

  if (!threadData) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8">
          <Link href="/forum" className="text-blue-600 hover:underline">
            ← Back to Forum
          </Link>
          <h1 className="text-2xl font-bold mt-4 text-gray-900 dark:text-white">Thread not found</h1>
          <p className="text-gray-600 dark:text-gray-400">
            This thread may have been removed or is not visible.
          </p>
        </main>
      </div>
    );
  }

  const { thread, posts, viewerIsModerator } = threadData;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8">
        <Link href="/forum" className="text-blue-600 hover:underline">
          ← Back to Forum
        </Link>

        <header className="mt-4 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {thread.title}
          </h1>

          <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            <span>{thread.topicType}</span>
            {thread.topic && <span> · {thread.topic}</span>}
            <span> · {thread._count?.posts ?? 0} posts</span>
            <span> · by {formatAuthor(thread.author)}</span>
            <span> · {formatDate(thread.createdAt)}</span>
          </div>

          {thread.isLocked && (
            <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200">
              <strong>Thread locked.</strong>{" "}
              {thread.lockedReason ? `Reason: ${thread.lockedReason}` : null}
            </div>
          )}
        </header>

        {/* Login prompt for guests */}
        {!isLoggedIn && !thread.isLocked && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-gray-700 dark:text-gray-300 mb-3">
              Sign in to reply to this discussion.
            </p>
            <Link
              href={`/login?redirect=/forum/threads/${id}`}
              className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              Sign In to Reply
            </Link>
          </div>
        )}

        {posts.length === 0 && (
          <p className="text-gray-600 dark:text-gray-400 mb-6">No posts yet. Be the first to reply!</p>
        )}
        
        <ThreadRepliesClient
          threadId={thread.id}
          isLocked={thread.isLocked}
          posts={posts}
          viewerIsModerator={viewerIsModerator}
          isLoggedIn={isLoggedIn}
        />
      </main>
    </div>
  );
}
