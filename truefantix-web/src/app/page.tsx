"use client";

import React, { useState } from "react";

export default function ComingSoonPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    try {
      const res = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "landing_page" }),
      });

      if (res.ok) {
        setSubmitted(true);
        setEmail("");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 flex flex-col items-center justify-center px-4 sm:px-6">
      <div className="max-w-2xl w-full text-center">
        {/* Logo */}
        <div className="mb-12">
          <span className="text-6xl sm:text-7xl lg:text-8xl font-extrabold tracking-tight bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
            TrueFanTix
          </span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 dark:text-white mb-4">
          Welcome to TrueFanTix
        </h1>

        <p className="text-xl sm:text-2xl text-slate-600 dark:text-slate-300 mb-2">
          Tickets to live events at or below face value.
        </p>

        <p className="text-2xl sm:text-3xl font-semibold text-slate-400 dark:text-slate-500 mb-16">
          Coming Soon...
        </p>

        {/* Early Access Form */}
        {!submitted ? (
          <div className="max-w-md mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 border border-slate-200 dark:border-slate-700">
            <h2 className="text-2xl font-bold mb-2 text-slate-900 dark:text-white">
              Join the Early Access List
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              Be the first to know when we launch. No spam, just tickets.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                  className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
              </div>

              <button
                type="submit"
                className="w-full px-6 py-3 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold hover:from-blue-700 hover:to-purple-700 transition shadow-lg hover:shadow-xl"
              >
                Notify Me
              </button>
            </form>

            {error && (
              <p className="mt-4 text-red-500 text-sm">{error}</p>
            )}
          </div>
        ) : (
          <div className="max-w-md mx-auto bg-green-50 dark:bg-green-900/20 rounded-2xl shadow-xl p-8 border border-green-200 dark:border-green-800">
            <p className="text-green-700 dark:text-green-400 text-xl font-semibold mb-2">
              You're on the list! 🎉
            </p>
            <p className="text-green-600 dark:text-green-500">
              We'll let you know when TrueFanTix goes live.
            </p>
          </div>
        )}

        <p className="mt-16 text-slate-400 dark:text-slate-600 text-sm">
          © 2026 TrueFanTix. All rights reserved.
        </p>
      </div>
    </div>
  );
}
