"use client";

import React, { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { VisibleAdminRequest } from "@/lib/dispute-case";

export default function DisputeUpdateForm({
  orderId,
  adminRequests = [],
  onSubmitted,
}: {
  orderId: string;
  adminRequests?: VisibleAdminRequest[];
  onSubmitted?: () => void;
}) {
  const [comments, setComments] = useState("");
  const [files, setFiles] = useState<Array<{ data: string; fileName: string; size: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    setError(null);
    if (files.length + selected.length > 5) return setError("You can attach up to 5 documents per update.");
    if (files.reduce((sum, file) => sum + file.size, 0) + selected.reduce((sum, file) => sum + file.size, 0) > 2_000_000) {
      return setError("Documents must be 2 MB or smaller in total.");
    }
    try {
      const next = await Promise.all(selected.map((file) => new Promise<{ data: string; fileName: string; size: number }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve({ data: reader.result, fileName: file.name, size: file.size }) : reject();
        reader.onerror = reject;
        reader.readAsDataURL(file);
      })));
      setFiles((current) => [...current, ...next]);
    } catch {
      setError("Could not read one or more documents.");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch("/api/orders/dispute/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, comments, evidenceFiles: files.map(({ data, fileName }) => ({ data, fileName })) }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.message || "Could not submit dispute information.");
      setComments("");
      setFiles([]);
      setMessage("Your comments and documents were added to the dispute. TrueFanTix Support has been notified.");
      window.dispatchEvent(new Event("tft:user-actions-changed"));
      onSubmitted?.();
    } catch (err: any) {
      setError(err?.message || "Could not submit dispute information.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8, marginTop: 12, padding: 12, borderRadius: 10, border: "1px solid rgba(185,28,28,.22)", background: "rgba(255,247,237,1)" }}>
      {adminRequests.length ? (
        <section style={{ display: "grid", gap: 8, marginBottom: 4 }}>
          <strong style={{ color: "rgba(6,74,147,1)" }}>Messages from TrueFanTix Support</strong>
          {adminRequests.map((request) => (
            <div key={request.id} style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(37,99,235,.25)", background: "rgba(239,246,255,1)" }}>
              <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.72 }}>
                Information requested {new Date(request.requestedAt).toLocaleString()}
              </div>
              <div style={{ marginTop: 5, whiteSpace: "pre-wrap", fontWeight: 800 }}>{request.message}</div>
            </div>
          ))}
          <div style={{ fontSize: 12, opacity: 0.75 }}>Reply below and attach any requested supporting documents.</div>
        </section>
      ) : null}
      <strong>{adminRequests.length ? "Reply with comments or supporting documents" : "Add comments or supporting documents"}</strong>
      <textarea value={comments} onChange={(event) => setComments(event.target.value)} rows={3} maxLength={2000} placeholder="Add information that may help support review your case" style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,.18)" }} />
      <label style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(37,99,235,.4)", color: "rgba(30,64,175,1)", background: "white", fontWeight: 900, textAlign: "center", cursor: "pointer" }}>
        Attach supporting documents (optional)
        <input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx" onChange={addFiles} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} />
      </label>
      {files.map((file, index) => <div key={`${file.fileName}-${index}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span>{file.fileName}</span><button type="button" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} style={{ border: 0, background: "transparent", color: "#b91c1c", fontWeight: 800 }}>Remove</button></div>)}
      <small>Up to 5 JPG, PNG, WebP, PDF, DOC, or DOCX files; 2 MB total per update.</small>
      <button disabled={busy || (!comments.trim() && files.length === 0)} style={{ minHeight: 40, border: 0, borderRadius: 8, background: "#064a93", color: "white", fontWeight: 900 }}>{busy ? "Submitting..." : "Submit additional dispute information"}</button>
      {error ? <div role="alert" style={{ color: "#991b1b", fontSize: 12 }}>{error}</div> : null}
      {message ? <div style={{ color: "#166534", fontSize: 12 }}>{message}</div> : null}
    </form>
  );
}
