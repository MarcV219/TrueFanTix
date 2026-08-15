"use client";

import { useState } from "react";
import { fetchJson } from "@/lib/api-fetch";

export default function PinThreadButton({ threadId, isPinned }: { threadId: string; isPinned: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function togglePin() {
    setBusy(true);
    setError(null);
    try {
      const { res, data } = await fetchJson(`/api/admin/forum/threads/${encodeURIComponent(threadId)}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !isPinned }),
      });
      if (!res.ok) {
        setError(data?.message || "Could not update the pinned status.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Could not update the pinned status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <button type="button" onClick={togglePin} disabled={busy} className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-900/20 dark:text-amber-200">
        {busy ? "Saving…" : isPinned ? "Unpin discussion" : "📌 Pin discussion"}
      </button>
      {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}
