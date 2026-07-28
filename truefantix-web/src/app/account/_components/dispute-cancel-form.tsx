"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";

export default function DisputeCancelForm({ orderId, onCancelled }: { orderId: string; onCancelled: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancelDispute() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/orders/dispute/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, satisfactorilyResolved: agreed }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.message || "Could not cancel dispute.");
      onCancelled();
    } catch (err: any) {
      setError(err?.message || "Could not cancel dispute.");
    } finally {
      setBusy(false);
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        style={{
          minHeight: 40,
          borderRadius: 8,
          border: "1px solid rgba(22, 101, 52, 0.4)",
          background: "white",
          color: "rgba(22, 101, 52, 1)",
          fontWeight: 900,
          cursor: "pointer",
        }}
      >
        Cancel my dispute
      </button>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10, padding: 12, borderRadius: 9, border: "1px solid rgba(22, 101, 52, 0.28)", background: "rgba(240, 253, 244, 1)" }}>
      <strong style={{ color: "rgba(20, 83, 45, 1)" }}>Cancel and close this dispute?</strong>
      <div style={{ fontSize: 13, lineHeight: 1.45 }}>
        Cancelling confirms the issue has been resolved. The case will close and the seller payment will return to the normal payout process.
      </div>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
          style={{ width: 18, height: 18, marginTop: 1, flex: "0 0 auto" }}
        />
        I agree that this dispute has been satisfactorily resolved.
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setAgreed(false);
            setError(null);
          }}
          disabled={busy}
          style={{ minHeight: 40, borderRadius: 8, border: "1px solid rgba(15, 23, 42, 0.2)", background: "white", fontWeight: 900, cursor: "pointer" }}
        >
          Keep dispute open
        </button>
        <button
          type="button"
          onClick={cancelDispute}
          disabled={busy || !agreed}
          style={{
            minHeight: 40,
            borderRadius: 8,
            border: 0,
            background: agreed ? "rgba(22, 101, 52, 1)" : "rgba(148, 163, 184, 1)",
            color: "white",
            fontWeight: 900,
            cursor: agreed ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Closing..." : "Confirm and close dispute"}
        </button>
      </div>
      {error ? <div role="alert" style={{ color: "rgba(153, 27, 27, 1)", fontSize: 12 }}>{error}</div> : null}
    </div>
  );
}
