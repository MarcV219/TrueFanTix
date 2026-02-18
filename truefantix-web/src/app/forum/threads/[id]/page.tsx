// src/app/forum/threads/[id]/page.tsx
import Link from "next/link";
import { headers } from "next/headers";
import ThreadRepliesClient from "./threadreplies.client";

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
  visibility: string;
  createdAt: string;
  updatedAt: string;
  isLocked: boolean;
  lockedAt: string | null;
  lockedReason: string | null;
  authorUserId: string;
  author: ForumAuthor;
  _count: { posts: number };
};

type ForumPost = {
  id: string;
  threadId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  authorUserId: string;
  author: ForumAuthor;
  parentId: string | null;
  // If your API returns this (it should for moderation), we’ll pass it through safely.
  visibility?: string;
  visibilityReason?: string | null;
};

async function getBaseUrlFromHeaders() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  return `${proto}://${host}`;
}

async function getThread(threadId: string): Promise<{
  thread: ForumThread;
  posts: ForumPost[];
  viewerIsModerator: boolean;
}> {
  const h = await headers();
  const baseUrl = await getBaseUrlFromHeaders();
  if (!baseUrl) throw new Error("Unable to determine base URL from request headers.");

  // ✅ Critical fix:
  // Forward cookies so the API can see the same session/user role as the browser.
  const cookie = h.get("cookie") ?? "";

  const res = await fetch(`${baseUrl}/api/forum/threads/${encodeURIComponent(threadId)}`, {
    cache: "no-store",
    headers: cookie ? { cookie } : undefined,
  });

  if (res.status === 404) {
    throw new Error("NOT_FOUND");
  }

  if (!res.ok) {
    throw new Error("Failed to load thread");
  }

  const data = await res.json();
  return {
    thread: data.thread,
    posts: data.posts ?? [],
    viewerIsModerator: Boolean(data.viewerIsModerator),
  };
}

function formatAuthor(a: ForumAuthor) {
  return a.displayName ?? `${a.firstName} ${a.lastName}`;
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

  let thread: ForumThread;
  let posts: ForumPost[];
  let viewerIsModerator = false;

  try {
    const data = await getThread(id);
    thread = data.thread;
    posts = data.posts;
    viewerIsModerator = data.viewerIsModerator;
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    if (msg === "NOT_FOUND") {
      return (
        <main style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1rem" }}>
          <Link href="/forum" style={{ textDecoration: "none" }}>
            ← Back to Forum
          </Link>
          <h1 style={{ marginTop: "1rem" }}>Thread not found</h1>
          <p style={{ color: "#666" }}>
            This thread may have been removed or is not visible.
          </p>
        </main>
      );
    }

    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1rem" }}>
        <Link href="/forum" style={{ textDecoration: "none" }}>
          ← Back to Forum
        </Link>
        <h1 style={{ marginTop: "1rem" }}>Something went wrong</h1>
        <p style={{ color: "#666" }}>Unable to load this thread right now.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1rem" }}>
      <Link href="/forum" style={{ textDecoration: "none" }}>
        ← Back to Forum
      </Link>

      <header style={{ marginTop: "1rem", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.8rem", fontWeight: 650, margin: 0 }}>
          {thread.title}
        </h1>

        <div style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: "#666" }}>
          <span>{thread.topicType}</span>
          {thread.topic && <span> · {thread.topic}</span>}
          <span> · {thread._count.posts} posts</span>
          <span> · by {formatAuthor(thread.author)}</span>
          <span> · {formatDate(thread.createdAt)}</span>
        </div>

        {thread.isLocked && (
          <div
            style={{
              marginTop: "0.75rem",
              padding: "0.75rem 1rem",
              border: "1px solid #f2d6d6",
              background: "#fff7f7",
              borderRadius: 10,
              color: "#7a1f1f",
            }}
          >
            <strong>Thread locked.</strong>{" "}
            {thread.lockedReason ? `Reason: ${thread.lockedReason}` : null}
          </div>
        )}
      </header>

      {posts.length === 0 ? (
        <p style={{ color: "#666" }}>No posts yet.</p>
      ) : (
        <ThreadRepliesClient
          threadId={thread.id}
          isLocked={thread.isLocked}
          posts={posts as any}
          viewerIsModerator={viewerIsModerator}
        />
      )}
    </main>
  );
}
