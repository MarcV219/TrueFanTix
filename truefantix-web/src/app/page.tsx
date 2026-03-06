"use client";

import React, { useState } from "react";
import Image from "next/image";

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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 flex flex-col items-center justify-center px-4 sm:px-6 py-12">
      <div className="max-w-2xl w-full text-center">
        {/* Prominent Logo */}
        <div className="mb-12 flex justify-center">
          <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8">
            <Image
              src="/brand/truefantix-lockup.jpeg"
              alt="TrueFanTix"
              width={600}
              height={180}
              className="w-auto h-auto max-w-[350px] sm:max-w-[450px] lg:max-w-[550px]"
              priority
            />
          </div>
        </div>

        {/* Tagline */}
        <p className="text-xl sm:text-2xl text-slate-600 dark:text-slate-300 mb-3">
          Tickets to live events <span className="font-bold underline">at or below face value</span>.
        </p>

        <p className="text-2xl sm:text-3xl font-semibold text-slate-400 dark:text-slate-500 mb-16">
          Coming Soon...
        </p>

        {/* Early Access Form */}
        {!submitted ? (
          <div className="max-w-md mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 border border-slate-200 dark:border-slate-700">
            <h2 className="text-2xl font-bold mb-3 text-slate-900 dark:text-white">
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

        {/* Social Links */}
        <div className="mt-12 max-w-xl mx-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/70 shadow-lg p-6 sm:p-7">
          <p className="mb-5 text-lg sm:text-xl font-semibold text-slate-800 dark:text-slate-100">
            For more information, follow us on
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            <a
              href="https://www.facebook.com/TrueFanTix"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-600 text-white font-semibold text-sm sm:text-base hover:bg-blue-700 transition shadow"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.025 4.388 11.019 10.125 11.927v-8.437H7.078v-3.49h3.047V9.414c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953h-1.514c-1.492 0-1.956.93-1.956 1.885v2.255h3.328l-.532 3.49h-2.796V24C19.612 23.092 24 18.098 24 12.073z" />
              </svg>
              <span className="text-white">Facebook</span>
            </a>
            <a
              href="https://x.com/truefantix"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900 text-white font-semibold text-sm sm:text-base hover:bg-slate-700 transition shadow"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                <path d="M18.244 2H21l-6.01 6.87L22 22h-5.46l-4.276-5.593L7.39 22H4.632l6.43-7.35L2 2h5.6l3.865 5.11L18.244 2zm-.966 18.32h1.527L6.77 3.595H5.13L17.278 20.32z" />
              </svg>
              <span className="text-white">X</span>
            </a>
            <a
              href="https://www.instagram.com/truefantix/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-pink-500 to-orange-500 text-white font-semibold text-sm sm:text-base hover:opacity-90 transition shadow"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                <path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2zm0 1.75a4 4 0 0 0-4 4v8.5a4 4 0 0 0 4 4h8.5a4 4 0 0 0 4-4v-8.5a4 4 0 0 0-4-4h-8.5zm9.188 1.312a1.125 1.125 0 1 1 0 2.25 1.125 1.125 0 0 1 0-2.25zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 1.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5z" />
              </svg>
              <span className="text-white">Instagram</span>
            </a>
          </div>
        </div>

        {/* Copyright */}
        <p className="mt-10 text-slate-400 dark:text-slate-600 text-sm">
          © 2026 TrueFanTix. All rights reserved.
        </p>
      </div>
    </div>
  );
}
