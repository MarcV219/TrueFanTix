"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LanguageSwitch, useLanguage } from "@/app/_components/language-provider";

const WELCOME_SEEN_KEY = "tft_community_welcome_seen";

export default function CommunityWelcome() {
  const pathname = usePathname() || "/";
  const { language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const copy = language === "fr"
    ? {
        eyebrow: "Un accueil personnel",
        title: "Nous bâtissons ceci avec des amateurs comme vous",
        introduction: "TrueFanTix vient de voir le jour. Il se peut donc que vous ne trouviez aujourd’hui que quelques billets — ou même aucun — pour l’événement qui vous intéresse. Je tiens à être honnête à ce sujet dès le départ.",
        difference: "Nous sommes différents des sites de revente traditionnels. Les amateurs en ont assez de voir des billets achetés rapidement, puis remis en vente à des prix inabordables. TrueFanTix maintient les billets au prix nominal ou moins et n’est pas une plateforme pour les revendeurs — c’est une communauté pour les vrais amateurs.",
        support: "Pour faire grandir cette meilleure façon de faire, nous avons besoin de votre soutien. Vous pouvez nous aider en créant un compte, en mettant un billet en vente lorsque vos plans changent, en achetant auprès d’un autre amateur et en activant des notifications pour les artistes et les équipes que vous aimez.",
        promotionBeforeFirst: "Pendant notre promotion de lancement d’une durée limitée, la création d’un compte gratuit vous donne",
        firstTokens: "4 jetons d’accès",
        promotionBetween: "Vous pouvez gagner",
        secondTokens: "4 autres jetons d’accès pour chaque billet que vous vendez",
        promotionAfter: "pendant la promotion.",
        thanks: "Merci d’être là dès le début. J’espère que vous nous aiderez à bâtir quelque chose de plus équitable — ensemble.",
        founder: "Fondateur, TrueFanTix",
        continue: "Continuer vers le site",
        learnMore: "Continuez pour en apprendre davantage sur nous et sur le fonctionnement de TrueFanTix.",
      }
    : {
        eyebrow: "A personal welcome",
        title: "We're building this with fans like you",
        introduction: "TrueFanTix is brand new, so you may find only a few tickets—or none at all—for the event you want today. I want to be honest about that from the start.",
        difference: "We're different from traditional resale sites. Fans are tired of seeing tickets snapped up and relisted at prices they can't afford. TrueFanTix keeps tickets at or below face value, and it isn't a marketplace for scalpers—it's a community for real fans.",
        support: "For this better way to grow, we need your support. You can help by signing up, listing a ticket when your plans change, buying from another fan, and setting notifications for the artists and teams you love.",
        promotionBeforeFirst: "During our limited-time launch promotion, creating a free account gives you",
        firstTokens: "4 access tokens",
        promotionBetween: "You can earn another",
        secondTokens: "4 access tokens for every ticket you sell",
        promotionAfter: "during the promotion.",
        thanks: "Thank you for being here at the beginning. I hope you'll help us build something fairer—together.",
        founder: "Founder, TrueFanTix",
        continue: "Continue to site",
        learnMore: "Continue to learn more about us and how TrueFanTix works.",
      };

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
        <main data-no-translate className="relative w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
          <div className="h-2 bg-[#15a6a1]" />
          <div className="absolute right-4 top-5 z-10 sm:right-6 sm:top-6">
            <LanguageSwitch />
          </div>
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
              {copy.eyebrow}
            </p>
            <h1
              id="community-welcome-title"
              className="text-3xl font-bold tracking-tight text-[#064a93] sm:text-4xl dark:text-white"
            >
              {copy.title}
            </h1>

            <div
              id="community-welcome-description"
              className="mx-auto mt-6 max-w-2xl space-y-4 text-left text-base leading-7 text-gray-700 sm:text-lg dark:text-gray-300"
            >
              <p>{copy.introduction}</p>
              <p>{copy.difference}</p>
              <p>{copy.support}</p>
              <p>
                {copy.promotionBeforeFirst} <strong>{copy.firstTokens}</strong>. {copy.promotionBetween} <strong>{copy.secondTokens}</strong> {copy.promotionAfter}
              </p>
              <p className="font-semibold text-gray-900 dark:text-white">
                {copy.thanks}
              </p>
            </div>

            <div className="mt-8 border-t border-gray-200 pt-6 dark:border-gray-700">
              <p className="font-semibold text-gray-900 dark:text-white">Marc</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">{copy.founder}</p>
            </div>

            <button
              type="button"
              onClick={continueToSite}
              autoFocus
              className="button-primary mt-8 min-h-12 w-full rounded-lg px-8 py-3 text-base font-bold shadow-md transition hover:shadow-lg sm:w-auto"
            >
              {copy.continue}
            </button>
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
              {copy.learnMore}
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
