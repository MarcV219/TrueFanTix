"use client";

import React from "react";
import { usePathname } from "next/navigation";

import {
  LANGUAGE_COOKIE,
  LANGUAGE_STORAGE_KEY,
  type SiteLanguage,
  translateText,
} from "@/lib/language";

type LanguageContextValue = {
  language: SiteLanguage;
  setLanguage: (language: SiteLanguage) => void;
  t: (text: string) => string;
};

const LanguageContext = React.createContext<LanguageContextValue>({
  language: "en",
  setLanguage: () => undefined,
  t: (text) => text,
});

const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const translatedAttributes = ["placeholder", "title", "aria-label"];

function translateNode(root: ParentNode, language: SiteLanguage) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;

  while (node) {
    const parent = node.parentElement;
    if (parent && !parent.closest("[data-no-translate], script, style, code, pre")) {
      const source = originalText.get(node) ?? node.data;
      if (!originalText.has(node)) originalText.set(node, source);
      const leading = source.match(/^\s*/)?.[0] ?? "";
      const trailing = source.match(/\s*$/)?.[0] ?? "";
      const content = source.trim();
      if (content) node.data = `${leading}${translateText(content, language)}${trailing}`;
    }
    node = walker.nextNode() as Text | null;
  }

  const elements = root instanceof Element ? [root, ...root.querySelectorAll("*")] : [...root.querySelectorAll("*")];
  for (const element of elements) {
    if (element.closest("[data-no-translate]")) continue;
    let saved = originalAttributes.get(element);
    if (!saved) {
      saved = new Map();
      originalAttributes.set(element, saved);
    }
    for (const attribute of translatedAttributes) {
      const current = element.getAttribute(attribute);
      if (current == null) continue;
      if (!saved.has(attribute)) saved.set(attribute, current);
      element.setAttribute(attribute, translateText(saved.get(attribute)!, language));
    }
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const [preferredLanguage, setPreferredLanguage] = React.useState<SiteLanguage>("en");
  const language: SiteLanguage = isAdmin ? "en" : preferredLanguage;

  React.useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === "fr" || saved === "en") setPreferredLanguage(saved);
  }, []);

  React.useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dataset.language = language;
    translateNode(document.body, language);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData" && record.target instanceof Text && record.target.parentNode) {
          const current = record.target.data;
          const source = originalText.get(record.target);
          if (source && current !== source && current !== translateText(source.trim(), language)) {
            originalText.set(record.target, current);
          }
          const latestSource = originalText.get(record.target) ?? current;
          const leading = latestSource.match(/^\s*/)?.[0] ?? "";
          const trailing = latestSource.match(/\s*$/)?.[0] ?? "";
          const content = latestSource.trim();
          const translated = content ? `${leading}${translateText(content, language)}${trailing}` : latestSource;
          if (record.target.data !== translated) record.target.data = translated;
        }
        for (const added of record.addedNodes) {
          if (added.nodeType === Node.TEXT_NODE && added.parentNode) translateNode(added.parentNode, language);
          else if (added instanceof Element) translateNode(added, language);
        }
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [language, pathname]);

  const setLanguage = React.useCallback((next: SiteLanguage) => {
    setPreferredLanguage(next);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    document.cookie = `${LANGUAGE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, []);

  const value = React.useMemo(
    () => ({ language, setLanguage, t: (text: string) => translateText(text, language) }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return React.useContext(LanguageContext);
}

export function LanguageSwitch() {
  const { language, setLanguage } = useLanguage();
  return (
    <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-white/70 p-0.5 dark:bg-white/5" aria-label="Select language">
      <button type="button" onClick={() => setLanguage("en")} aria-pressed={language === "en"} className={`rounded-md px-2 py-1.5 text-xs font-bold transition ${language === "en" ? "bg-[var(--tft-navy)] text-white" : "text-[var(--foreground)] hover:bg-black/5"}`}>
        EN
      </button>
      <button type="button" onClick={() => setLanguage("fr")} aria-pressed={language === "fr"} className={`rounded-md px-2 py-1.5 text-xs font-bold transition ${language === "fr" ? "bg-[var(--tft-navy)] text-white" : "text-[var(--foreground)] hover:bg-black/5"}`}>
        FR
      </button>
    </div>
  );
}
