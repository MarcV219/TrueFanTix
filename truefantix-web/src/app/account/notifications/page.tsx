"use client";

import React from "react";
import Link from "next/link";
import AccountGate from "@/app/account/_components/accountgate";
import { fetchJson } from "@/lib/api-fetch";

type PreferenceType = "ARTIST" | "TEAM" | "VENUE" | "CITY";

type Preference = {
  id: string;
  type: PreferenceType;
  value: string;
  status: string;
};

type CatalogSuggestion = {
  type: PreferenceType;
  value: string;
  label: string;
  subtitle?: string;
  address?: string;
  city?: string;
  region?: string;
  country?: string;
};

const TYPE_OPTIONS: Array<{ value: PreferenceType; label: string }> = [
  { value: "ARTIST", label: "Artist" },
  { value: "TEAM", label: "Team" },
  { value: "VENUE", label: "Venue" },
  { value: "CITY", label: "City" },
];

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 860, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 950, margin: 0 }}>{title}</h1>
          <div style={{ marginTop: 6, opacity: 0.8 }}>
            <Link href="/account" style={{ textDecoration: "underline" }}>
              ← Back to Account
            </Link>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link href="/" style={{ textDecoration: "underline" }}>
            Home
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>{children}</div>
    </div>
  );
}

function Body() {
  const [preferences, setPreferences] = React.useState<Preference[]>([]);
  const [selectedType, setSelectedType] = React.useState<PreferenceType>("ARTIST");
  const [value, setValue] = React.useState("");
  const [selectedSuggestion, setSelectedSuggestion] = React.useState<CatalogSuggestion | null>(null);
  const [suggestions, setSuggestions] = React.useState<CatalogSuggestion[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;

    async function loadPreferences() {
      setLoading(true);
      setError(null);
      try {
        const { res, data } = await fetchJson("/api/notifications/preferences", {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok || !data?.ok) {
          throw new Error(String(data?.message || data?.error || "Could not load notification preferences."));
        }
        if (alive) setPreferences(Array.isArray(data.preferences) ? data.preferences : []);
      } catch (e: any) {
        if (alive) setError(e?.message ?? "Could not load notification preferences.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadPreferences();
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }

    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, type: selectedType, limit: "12" });
        const res = await fetch(`/api/catalog/suggestions?${params.toString()}`, { cache: "no-store" });
        const data = await res.json();
        if (alive) setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
      } catch {
        if (alive) setSuggestions([]);
      }
    }, 160);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [selectedType, value]);

  const trimmedValue = value.trim();
  const canAddSelectedSuggestion =
    !!selectedSuggestion && selectedSuggestion.type === selectedType && selectedSuggestion.label === trimmedValue;
  const canAddCustomArtist = selectedType === "ARTIST" && trimmedValue.length >= 2 && !selectedSuggestion;
  const canAdd = canAddSelectedSuggestion || canAddCustomArtist;

  async function addPreference(e: React.FormEvent) {
    e.preventDefault();
    if (!canAdd) {
      setError(
        selectedType === "ARTIST"
          ? "Choose a suggestion or enter at least 2 characters for the artist."
          : "Choose an item from the suggestions before adding it."
      );
      setOk(null);
      return;
    }

    const preferenceValue = (selectedSuggestion?.value ?? trimmedValue).trim();

    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const { res, data } = await fetchJson("/api/notifications/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: selectedType, value: preferenceValue }),
      });

      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.message || data?.error || "Could not add notification preference."));
      }

      const next = data.preference as Preference;
      setPreferences((prev) => {
        const withoutDuplicate = prev.filter((item) => item.id !== next.id);
        return [...withoutDuplicate, next].sort((a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value));
      });
      setValue("");
      setSelectedSuggestion(null);
      setSuggestions([]);
      setOk("Notification preference saved.");
    } catch (e: any) {
      setError(e?.message ?? "Could not add notification preference.");
    } finally {
      setBusy(false);
    }
  }

  async function removePreference(id: string) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const { res, data } = await fetchJson("/api/notifications/preferences", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.message || data?.error || "Could not remove notification preference."));
      }

      setPreferences((prev) => prev.filter((item) => item.id !== id));
      setOk("Notification preference removed.");
    } catch (e: any) {
      setError(e?.message ?? "Could not remove notification preference.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "white",
      }}
    >
      <div style={{ fontWeight: 950, fontSize: 18 }}>Notification interests</div>
      <div style={{ marginTop: 8, opacity: 0.85 }}>
        Add artists, teams, venues, and cities for alerts and sold-out access matching.
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 10,
            border: "1px solid rgba(255,0,0,0.35)",
            background: "rgba(254, 242, 242, 1)",
            color: "rgba(153, 27, 27, 1)",
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      ) : null}

      {ok ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 10,
            border: "1px solid rgba(34, 197, 94, 0.35)",
            background: "rgba(240, 253, 244, 1)",
            color: "rgba(22, 101, 52, 1)",
            fontWeight: 800,
          }}
        >
          {ok}
        </div>
      ) : null}

      <form onSubmit={addPreference} style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <select
            value={selectedType}
            onChange={(e) => {
              setSelectedType(e.target.value as PreferenceType);
              setValue("");
              setSelectedSuggestion(null);
              setSuggestions([]);
            }}
            disabled={busy}
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(148, 163, 184, 0.9)",
              background: "rgba(248, 250, 252, 1)",
              fontWeight: 800,
              flex: "1 1 150px",
            }}
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <div style={{ flex: "999 1 260px" }}>
            <input
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setSelectedSuggestion(null);
              }}
              disabled={busy}
              placeholder={`Start typing a ${selectedType.toLowerCase()}...`}
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 10,
                border: "1px solid rgba(148, 163, 184, 0.9)",
                background: "rgba(248, 250, 252, 1)",
              }}
            />
            {value.trim().length >= 2 ? (
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {suggestions.length > 0 ? (
                  suggestions.map((suggestion) => {
                    const isSelected = selectedSuggestion?.type === suggestion.type && selectedSuggestion.value === suggestion.value;
                    return (
                      <button
                        key={`${suggestion.type}:${suggestion.value}`}
                        type="button"
                        onClick={() => {
                          setSelectedSuggestion(suggestion);
                          setValue(suggestion.label);
                          setSuggestions([]);
                          setError(null);
                          setOk(null);
                        }}
                        disabled={busy}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: 10,
                          borderRadius: 10,
                          border: isSelected
                            ? "1px solid rgba(37, 99, 235, 0.65)"
                            : "1px solid rgba(148, 163, 184, 0.55)",
                          background: isSelected ? "rgba(239, 246, 255, 1)" : "white",
                          cursor: busy ? "not-allowed" : "pointer",
                        }}
                      >
                        <span style={{ display: "block", fontWeight: 950 }}>{suggestion.label}</span>
                        <span style={{ display: "block", marginTop: 2, fontSize: 12, opacity: 0.72 }}>
                          {suggestion.subtitle ?? suggestion.type}
                        </span>
                      </button>
                    );
                  })
                ) : selectedSuggestion ? null : selectedType === "ARTIST" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSuggestion({
                        type: "ARTIST",
                        value: value.trim(),
                        label: value.trim(),
                        subtitle: "Custom artist or band",
                      });
                      setSuggestions([]);
                      setError(null);
                      setOk(null);
                    }}
                    disabled={busy}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid rgba(148, 163, 184, 0.55)",
                      background: "white",
                      cursor: busy ? "not-allowed" : "pointer",
                    }}
                  >
                    <span style={{ display: "block", fontWeight: 950 }}>Add "{value.trim()}"</span>
                    <span style={{ display: "block", marginTop: 2, fontSize: 12, opacity: 0.72 }}>
                      Custom artist or band
                    </span>
                  </button>
                ) : (
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid rgba(148, 163, 184, 0.35)",
                      background: "rgba(248, 250, 252, 1)",
                      fontSize: 13,
                      opacity: 0.78,
                    }}
                  >
                    No catalog match found. Check the spelling or try another term.
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={busy || !canAdd}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.12)",
              background: busy || !canAdd ? "rgba(148, 163, 184, 0.18)" : "rgba(15, 23, 42, 0.92)",
              color: busy || !canAdd ? "rgba(15,23,42,0.55)" : "white",
              fontWeight: 950,
              cursor: busy || !canAdd ? "not-allowed" : "pointer",
            }}
          >
            Add
          </button>
        </div>
      </form>

      <div style={{ marginTop: 18, display: "grid", gap: 8 }}>
        {loading ? <div style={{ opacity: 0.8 }}>Loading preferences...</div> : null}

        {!loading && preferences.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No notification interests yet.</div>
        ) : null}

        {preferences.map((preference) => {
          const typeLabel = TYPE_OPTIONS.find((option) => option.value === preference.type)?.label ?? preference.type;
          return (
            <div
              key={preference.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                padding: 12,
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.10)",
                background: "rgba(248, 250, 252, 1)",
              }}
            >
              <div>
                <div style={{ fontWeight: 950 }}>{preference.value}</div>
                <div style={{ fontSize: 12, opacity: 0.72 }}>
                  {typeLabel} - {preference.status}
                </div>
              </div>
              <button
                type="button"
                onClick={() => removePreference(preference.id)}
                disabled={busy}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.12)",
                  background: "white",
                  fontWeight: 900,
                  cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <Shell title="Notifications">
      <AccountGate
        nextPath="/account/notifications"
        loadingFallback={<p style={{ opacity: 0.8 }}>Loading…</p>}
        errorFallback={(message) => (
          <div
            role="alert"
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(255,0,0,0.35)",
              background: "rgba(254, 242, 242, 1)",
              color: "rgba(153, 27, 27, 1)",
            }}
          >
            {message}
          </div>
        )}
      >
        {() => <Body />}
      </AccountGate>
    </Shell>
  );
}
