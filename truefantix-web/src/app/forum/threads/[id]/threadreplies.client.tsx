"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ForumAuthor = {
  id: string;
  displayName: string | null;
  firstName: string;
  lastName: string;
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
  visibility: string; // "VISIBLE" | "HIDDEN" | "DELETED" | ...
  visibilityReason?: string | null;
};

type Props = {
  threadId: string;
  isLocked: boolean;
  posts: ForumPost[];
  viewerIsModerator: boolean;
  indentPx?: number; // default 18
  maxDepth?: number; // default 6
};

type PostNode = ForumPost & { replies: PostNode[] };

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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function buildPostTree(posts: ForumPost[]) {
  const byId = new Map<string, PostNode>();
  for (const p of posts) byId.set(p.id, { ...p, replies: [] });

  const roots: PostNode[] = [];
  for (const node of byId.values()) {
    const pid = node.parentId;
    if (pid && byId.has(pid)) byId.get(pid)!.replies.push(node);
    else roots.push(node);
  }

  const sortAsc = (a: PostNode, b: PostNode) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

  const sortTree = (nodes: PostNode[]) => {
    nodes.sort(sortAsc);
    for (const n of nodes) sortTree(n.replies);
  };

  sortTree(roots);
  return roots;
}

function friendlyError(status: number, json: any): string {
  const apiError = String(json?.error ?? "").toUpperCase();
  const apiMessage = typeof json?.message === "string" ? json.message : "";

  if (status === 400 && apiMessage) return apiMessage;

  if (status === 401 || apiError === "NOT_AUTHENTICATED" || apiError === "UNAUTHORIZED") {
    return "Please log in to reply.";
  }

  if (status === 403 && apiError === "NOT_VERIFIED") {
    return "Please verify your email and phone number to reply.";
  }

  if (status === 403 && apiError === "BANNED") {
    return "This account is restricted.";
  }

  if (status === 423 || apiError === "THREAD_LOCKED") {
    return "This thread is locked.";
  }

  if (apiMessage) return apiMessage;

  return `Request failed (${status}).`;
}

function InlineReplyComposer({
  threadId,
  parentId,
  parentAuthor,
  isLocked,
  indentPx,
  onClose,
  showNoNestingHint,
}: {
  threadId: string;
  parentId: string;
  parentAuthor: ForumAuthor;
  isLocked: boolean;
  indentPx: number;
  onClose: () => void;
  showNoNestingHint: boolean;
}) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const prefersReduced =
          typeof window !== "undefined" &&
          window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        boxRef.current?.scrollIntoView({
          behavior: prefersReduced ? "auto" : "smooth",
          block: "center",
        });

        textareaRef.current?.focus({ preventScroll: true });
      } catch {
        // ignore
      }
    }, 50);

    return () => clearTimeout(t);
  }, []);

  async function submit() {
    if (isLocked) {
      setStatusMsg("This thread is locked.");
      return;
    }

    const trimmed = body.trim();
    if (!trimmed.length) {
      setStatusMsg("Reply cannot be empty.");
      return;
    }

    setSubmitting(true);
    setStatusMsg(null);

    try {
      const res = await fetch("/api/forum/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          parentId,
          body: trimmed,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setStatusMsg(friendlyError(res.status, json));
        return;
      }

      window.location.reload();
    } catch (e: any) {
      setStatusMsg(String(e?.message ?? "Network error."));
    } finally {
      setSubmitting(false);
    }
  }

  const marginLeft = indentPx * 1;

  return (
    <div
      ref={boxRef}
      style={{
        marginTop: "0.75rem",
        marginLeft,
        padding: "0.75rem",
        border: "1px solid #eee",
        borderRadius: 10,
        background: "#fafafa",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontSize: "0.85rem", color: "#666" }}>
          Replying to{" "}
          <strong style={{ color: "#111" }}>{formatAuthor(parentAuthor)}</strong>
        </div>

        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: submitting ? "not-allowed" : "pointer",
            color: submitting ? "#999" : "#111",
            textDecoration: "underline",
            fontSize: "0.85rem",
          }}
          aria-label="Cancel reply"
        >
          Cancel
        </button>
      </div>

      {showNoNestingHint && (
        <div style={{ marginTop: "0.35rem", fontSize: "0.82rem", color: "#777" }}>
          Your reply will appear under the main post (deep nesting is disabled).
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder="Write your reply…"
        style={{
          width: "100%",
          marginTop: "0.5rem",
          padding: "0.6rem 0.7rem",
          borderRadius: 10,
          border: "1px solid #ddd",
          resize: "vertical",
          fontFamily: "inherit",
          fontSize: "0.95rem",
        }}
      />

      {statusMsg && (
        <div style={{ marginTop: "0.5rem", color: "#7a1f1f", fontSize: "0.9rem" }}>
          {statusMsg}
        </div>
      )}

      <div style={{ marginTop: "0.75rem", display: "flex", gap: 10 }}>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || isLocked}
          style={{
            padding: "0.55rem 0.85rem",
            borderRadius: 10,
            border: "1px solid #111",
            background: "#111",
            color: "#fff",
            cursor: submitting || isLocked ? "not-allowed" : "pointer",
            opacity: submitting || isLocked ? 0.6 : 1,
          }}
        >
          {submitting ? "Posting..." : "Post reply"}
        </button>
      </div>
    </div>
  );
}

export default function ThreadRepliesClient({
  threadId,
  isLocked,
  posts,
  viewerIsModerator,
  indentPx = 18,
  maxDepth = 6,
}: Props) {
  const roots = useMemo(() => buildPostTree(posts), [posts]);

  // Which post is being replied to (inline)
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [replyToAuthor, setReplyToAuthor] = useState<ForumAuthor | null>(null);
  const [replyToIsReply, setReplyToIsReply] = useState(false);

  // Per-post moderation action state
  const [modBusyPostId, setModBusyPostId] = useState<string | null>(null);
  const [modMsg, setModMsg] = useState<string | null>(null);

  // Top-level reply state
  const [topBody, setTopBody] = useState("");
  const [topSubmitting, setTopSubmitting] = useState(false);
  const [topStatusMsg, setTopStatusMsg] = useState<string | null>(null);

  async function setPostVisibility(postId: string, nextVisibility: "VISIBLE" | "HIDDEN") {
    setModBusyPostId(postId);
    setModMsg(null);

    try {
      const res = await fetch(`/api/admin/forum/posts/${encodeURIComponent(postId)}/visibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visibility: nextVisibility,
          reason: nextVisibility === "HIDDEN" ? "Hidden by moderator." : null,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setModMsg(friendlyError(res.status, json));
        return;
      }

      window.location.reload();
    } catch (e: any) {
      setModMsg(String(e?.message ?? "Network error."));
    } finally {
      setModBusyPostId(null);
    }
  }

  function toggleReply(post: PostNode) {
    if (replyToId === post.id) {
      setReplyToId(null);
      setReplyToAuthor(null);
      setReplyToIsReply(false);
      return;
    }
    setReplyToId(post.id);
    setReplyToAuthor(post.author);
    setReplyToIsReply(Boolean(post.parentId));
  }

  async function submitTopLevelPost() {
    if (isLocked) {
      setTopStatusMsg("This thread is locked.");
      return;
    }

    const trimmed = topBody.trim();
    if (!trimmed.length) {
      setTopStatusMsg("Reply cannot be empty.");
      return;
    }

    setTopSubmitting(true);
    setTopStatusMsg(null);

    try {
      const res = await fetch("/api/forum/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          parentId: null,
          body: trimmed,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setTopStatusMsg(friendlyError(res.status, json));
        return;
      }

      window.location.reload();
    } catch (e: any) {
      setTopStatusMsg(String(e?.message ?? "Network error."));
    } finally {
      setTopSubmitting(false);
    }
  }

  function PostNodeView({ node, depth }: { node: PostNode; depth: number }) {
    const cappedDepth = clamp(depth, 0, maxDepth);
    const marginLeft = cappedDepth * indentPx;
    const showThreadLine = cappedDepth > 0;

    const isHidden = String(node.visibility).toUpperCase() === "HIDDEN";
    const isReplyingHere = replyToId === node.id;

    const canReply = !isLocked && (!isHidden || viewerIsModerator);
    const showReplyAction = !isHidden || viewerIsModerator; // ✅ key change (public cannot reply to hidden)

    return (
      <li
        style={{
          padding: "1rem 0",
          marginLeft,
          borderTop: depth === 0 ? "1px solid #eee" : "none",
        }}
      >
        <div
          style={{
            paddingLeft: showThreadLine ? 12 : 0,
            borderLeft: showThreadLine ? "2px solid #eee" : "none",
          }}
        >
          <div style={{ fontSize: "0.85rem", color: "#666" }}>
            <strong style={{ color: "#111" }}>{formatAuthor(node.author)}</strong>{" "}
            · {formatDate(node.createdAt)}
            {isHidden && viewerIsModerator && (
              <span style={{ marginLeft: 10, color: "#7a1f1f" }}>(Hidden)</span>
            )}
          </div>

          {/* Body / Placeholder */}
          {isHidden && !viewerIsModerator ? (
            <div
              style={{
                marginTop: "0.6rem",
                padding: "0.75rem",
                borderRadius: 10,
                border: "1px solid #eee",
                background: "#fafafa",
                color: "#777",
                fontStyle: "italic",
              }}
            >
              This post was hidden by a moderator.
            </div>
          ) : (
            <div style={{ marginTop: "0.5rem", whiteSpace: "pre-wrap" }}>{node.body}</div>
          )}

          <div style={{ marginTop: "0.5rem", display: "flex", gap: 12, alignItems: "center" }}>
            {/* Reply (hidden from public if the post is hidden) */}
            {showReplyAction && (
              <button
                type="button"
                onClick={() => toggleReply(node)}
                disabled={!canReply}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: canReply ? "pointer" : "not-allowed",
                  color: canReply ? "#111" : "#999",
                  textDecoration: "underline",
                  fontSize: "0.85rem",
                }}
              >
                {isReplyingHere ? "Close" : "Reply"}
              </button>
            )}

            {isLocked && <span style={{ fontSize: "0.85rem", color: "#999" }}>Locked</span>}

            {/* Moderator actions */}
            {viewerIsModerator && (
              <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                {!isHidden ? (
                  <button
                    type="button"
                    onClick={() => setPostVisibility(node.id, "HIDDEN")}
                    disabled={modBusyPostId === node.id}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: modBusyPostId === node.id ? "not-allowed" : "pointer",
                      color: modBusyPostId === node.id ? "#999" : "#7a1f1f",
                      textDecoration: "underline",
                      fontSize: "0.85rem",
                    }}
                  >
                    {modBusyPostId === node.id ? "Hiding..." : "Hide"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPostVisibility(node.id, "VISIBLE")}
                    disabled={modBusyPostId === node.id}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: modBusyPostId === node.id ? "not-allowed" : "pointer",
                      color: modBusyPostId === node.id ? "#999" : "#111",
                      textDecoration: "underline",
                      fontSize: "0.85rem",
                    }}
                  >
                    {modBusyPostId === node.id ? "Restoring..." : "Restore"}
                  </button>
                )}
              </span>
            )}
          </div>

          {/* Optional moderation message */}
          {modMsg && viewerIsModerator && (
            <div style={{ marginTop: "0.5rem", color: "#7a1f1f", fontSize: "0.9rem" }}>
              {modMsg}
            </div>
          )}

          {node.replies.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "0.75rem 0 0 0" }}>
              {node.replies.map((child) => (
                <PostNodeView key={child.id} node={child} depth={depth + 1} />
              ))}
            </ul>
          )}
        </div>

        {/* Inline reply composer */}
        {isReplyingHere && replyToAuthor && canReply && (
          <InlineReplyComposer
            key={replyToId ?? "none"}
            threadId={threadId}
            parentId={node.id}
            parentAuthor={replyToAuthor}
            isLocked={isLocked}
            indentPx={indentPx}
            showNoNestingHint={replyToIsReply}
            onClose={() => {
              setReplyToId(null);
              setReplyToAuthor(null);
              setReplyToIsReply(false);
            }}
          />
        )}
      </li>
    );
  }

  return (
    <div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {roots.map((root) => (
          <PostNodeView key={root.id} node={root} depth={0} />
        ))}
      </ul>

      {/* Top-level reply box */}
      <div
        style={{
          marginTop: "1.5rem",
          paddingTop: "1.25rem",
          borderTop: "1px solid #eee",
        }}
      >
        <div style={{ fontSize: "1rem", fontWeight: 650, color: "#111" }}>
          Add a reply to this thread
        </div>

        {isLocked && (
          <div style={{ marginTop: "0.5rem", color: "#999", fontSize: "0.9rem" }}>
            This thread is locked.
          </div>
        )}

        <textarea
          value={topBody}
          onChange={(e) => setTopBody(e.target.value)}
          rows={4}
          placeholder="Write a new post…"
          disabled={isLocked}
          style={{
            width: "100%",
            marginTop: "0.75rem",
            padding: "0.7rem 0.8rem",
            borderRadius: 12,
            border: "1px solid #ddd",
            resize: "vertical",
            fontFamily: "inherit",
            fontSize: "0.95rem",
            opacity: isLocked ? 0.7 : 1,
          }}
        />

        {topStatusMsg && (
          <div style={{ marginTop: "0.5rem", color: "#7a1f1f", fontSize: "0.9rem" }}>
            {topStatusMsg}
          </div>
        )}

        <div style={{ marginTop: "0.75rem", display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={submitTopLevelPost}
            disabled={topSubmitting || isLocked}
            style={{
              padding: "0.6rem 0.95rem",
              borderRadius: 12,
              border: "1px solid #111",
              background: "#111",
              color: "#fff",
              cursor: topSubmitting || isLocked ? "not-allowed" : "pointer",
              opacity: topSubmitting || isLocked ? 0.6 : 1,
            }}
          >
            {topSubmitting ? "Posting..." : "Post"}
          </button>

          <button
            type="button"
            onClick={() => {
              setTopStatusMsg(null);
              setTopBody("");
            }}
            disabled={topSubmitting || isLocked}
            style={{
              padding: "0.6rem 0.95rem",
              borderRadius: 12,
              border: "1px solid #ddd",
              background: "#fff",
              color: "#111",
              cursor: topSubmitting || isLocked ? "not-allowed" : "pointer",
              opacity: topSubmitting || isLocked ? 0.6 : 1,
            }}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
