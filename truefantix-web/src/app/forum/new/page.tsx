"use client";

import { useState } from "react";
import Link from "next/link";
import Footer from "@/components/Footer";

type TopicType = "ARTIST" | "TEAM" | "SHOW" | "OTHER";

const TOPIC_TYPES: { value: TopicType; label: string }[] = [
  { value: "ARTIST", label: "Artist" },
  { value: "TEAM", label: "Team" },
  { value: "SHOW", label: "Show" },
  { value: "OTHER", label: "Other" },
];

export default function NewThreadPage() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [topicType, setTopicType] = useState<TopicType>("OTHER");
  const [topic, setTopic] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [createdThreadId, setCreatedThreadId] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();

    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }
    if (trimmedTitle.length < 5) {
      setError("Title must be at least 5 characters.");
      return;
    }
    if (trimmedTitle.length > 200) {
      setError("Title must be 200 characters or less.");
      return;
    }
    if (!trimmedBody) {
      setError("Body is required.");
      return;
    }
    if (trimmedBody.length < 10) {
      setError("Body must be at least 10 characters.");
      return;
    }
    if (trimmedBody.length > 5000) {
      setError("Body must be 5000 characters or less.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/forum/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          body: trimmedBody,
          topicType,
          topic: topic.trim() || null,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        const msg = json?.message || json?.error || `Failed to create thread (${res.status})`;
        setError(msg);
        return;
      }

      setSuccess(true);
      setCreatedThreadId(json?.thread?.id || null);
      setTitle("");
      setBody("");
      setTopic("");
    } catch (e: any) {
      setError(e?.message || "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-12">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center border border-gray-200 dark:border-gray-700">
            <div className="text-5xl mb-4">✅</div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Thread Created!
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Your discussion has been posted successfully.
            </p>
            <div className="flex gap-4 justify-center">
              {createdThreadId && (
                <Link
                  href={`/forum/threads/${createdThreadId}`}
                  className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
                >
                  View Thread
                </Link>
              )}
              <Link
                href="/forum"
                className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white px-6 py-3 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition"
              >
                Back to Forum
              </Link>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/forum"
            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-sm"
          >
            ← Back to Forum
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-4 mb-2">
            Start a New Discussion
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Share your thoughts about artists, teams, shows, or anything related to events.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Title */}
          <div className="mb-6">
            <label htmlFor="title" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's your discussion about?"
              maxLength={200}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={submitting}
            />
            <p className="text-xs text-gray-500 mt-1">{title.length}/200 characters</p>
          </div>

          {/* Topic Type & Topic */}
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div>
              <label htmlFor="topicType" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Category
              </label>
              <select
                id="topicType"
                value={topicType}
                onChange={(e) => setTopicType(e.target.value as TopicType)}
                className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={submitting}
              >
                {TOPIC_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="topic" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Specific Topic <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., Taylor Swift, Raptors, Hamilton"
                maxLength={100}
                className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={submitting}
              />
            </div>
          </div>

          {/* Body */}
          <div className="mb-6">
            <label htmlFor="body" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Body <span className="text-red-500">*</span>
            </label>
            <textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Share your thoughts, questions, or insights..."
              rows={8}
              maxLength={5000}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
              disabled={submitting}
            />
            <p className="text-xs text-gray-500 mt-1">{body.length}/5000 characters</p>
          </div>

          {/* Submit */}
          <div className="flex gap-4">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Creating..." : "Create Discussion"}
            </button>
            <Link
              href="/forum"
              className="px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition"
            >
              Cancel
            </Link>
          </div>
        </form>
      </main>
      <Footer />
    </div>
  );
}
