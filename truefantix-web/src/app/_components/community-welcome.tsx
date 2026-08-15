"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const WELCOME_SEEN_KEY = "tft_community_welcome_seen";

export default function CommunityWelcome() {
  const pathname = usePathname() || "/";
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (pathname !== "/") return;

    const reveal = window.setTimeout(() => {
      try {
        setIsOpen(window.sessionStorage.getItem(WELCOME_SEEN_KEY) !== "1");
      } catch {
        setIsOpen(true);
      }
    }, 0);

    return () => window.clearTimeout(reveal);
  }, [pathname]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  function continueToSite() {
    try {
      window.sessionStorage.setItem(WELCOME_SEEN_KEY, "1");
    } catch {
      // Storage can be unavailable in privacy-focused browsers; continuing still works.
    }
    setIsOpen(false);
  }

  if (pathname !== "/" || !isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto bg-[#032f5e] px-4 py-6 sm:py-10"
      role="dialog"
      aria-modal="true"
      aria-labelledby="community-welcome-title"
      aria-describedby="community-welcome-description"
    >
      <div className="flex min-h-full items-center justify-center">
        <main className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
          <div className="h-2 bg-[#15a6a1]" />
          <div className="px-6 py-8 text-center sm:px-12 sm:py-12">
            <Image
              src="/brand/truefantix-lockup.jpeg"
              alt="TrueFanTix"
              width={220}
              height={86}
              priority
              className="mx-auto mb-7 h-auto w-[180px] rounded sm:w-[220px]"
            />

            <p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-[#0b7f7c]">
              A personal welcome
            </p>
            <h1
              id="community-welcome-title"
              className="text-3xl font-bold tracking-tight text-[#064a93] sm:text-4xl dark:text-white"
            >
              We&apos;re building this with fans like you
            </h1>

            <div
              id="community-welcome-description"
              className="mx-auto mt-6 max-w-2xl space-y-4 text-left text-base leading-7 text-gray-700 sm:text-lg dark:text-gray-300"
            >
              <p>
                TrueFanTix is brand new, so you may find only a few tickets—or none at all—for the event you want today. I want to be honest about that from the start.
              </p>
              <p>
                This is a fan-first marketplace where tickets stay at or below face value. For it to grow, it needs a community of real fans willing to give a better way a chance.
              </p>
              <p>
                You can help by signing up, listing a ticket when your plans change, buying from another fan, and setting notifications for the artists and teams you love. Every early member helps make the next fan&apos;s visit better.
              </p>
              <p className="font-semibold text-gray-900 dark:text-white">
                Thank you for being here at the beginning. I hope you&apos;ll help us build something fairer—together.
              </p>
            </div>

            <div className="mt-8 border-t border-gray-200 pt-6 dark:border-gray-700">
              <p className="font-semibold text-gray-900 dark:text-white">Marc</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Founder, TrueFanTix</p>
            </div>

            <button
              type="button"
              onClick={continueToSite}
              autoFocus
              className="button-primary mt-8 min-h-12 w-full rounded-lg px-8 py-3 text-base font-bold shadow-md transition hover:shadow-lg sm:w-auto"
            >
              Continue to site
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
