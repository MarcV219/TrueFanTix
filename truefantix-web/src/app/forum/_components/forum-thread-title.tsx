"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/app/_components/language-provider";
import { fetchJson } from "@/lib/api-fetch";

export default function ForumThreadTitle({ threadId, title }: { threadId: string; title: string }) {
  const { language } = useLanguage();
  const [translations, setTranslations] = useState<Partial<Record<"en" | "fr", string>>>({});

  useEffect(() => {
    if (translations[language] !== undefined) return;
    let cancelled = false;
    void fetchJson("/api/forum/translations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, threadIds: [threadId] }),
    }).then(({ res, data }) => {
      if (!cancelled && res.ok && data?.ok) {
        setTranslations((current) => ({ ...current, [language]: data.threadTitles?.[threadId] || title }));
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [language, threadId, title, translations]);

  return <span data-no-translate>{translations[language] ?? title}</span>;
}
