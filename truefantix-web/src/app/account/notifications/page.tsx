"use client";

import React from "react";
import Link from "next/link";
import AccountGate, { MeUser } from "@/app/account/_components/accountgate";
import { fetchJson } from "@/lib/api-fetch";

type PreferenceType = "ARTIST" | "TEAM" | "VENUE" | "CITY" | "SPORT";

type Preference = {
  id: string;
  type: PreferenceType;
  value: string;
  status: string;
  catalogEntityId?: string | null;
};

type CatalogSuggestion = {
  type: PreferenceType;
  value: string;
  label: string;
  catalogEntityId?: string;
  provider?: string;
  providerId?: string;
  canonicalName?: string;
  subtitle?: string;
  address?: string;
  city?: string;
  region?: string;
  country?: string;
  aliases?: string[];
};

type SpotifyArtistCandidate = {
  spotifyId: string;
  name: string;
  popularity?: number;
  source: "followed" | "top";
  spotifyUrl?: string;
  imageUrl?: string;
  match: CatalogSuggestion | null;
};

const TYPE_OPTIONS: Array<{ value: PreferenceType; label: string }> = [
  { value: "ARTIST", label: "Artist" },
  { value: "TEAM", label: "Team" },
  { value: "VENUE", label: "Venue" },
  { value: "CITY", label: "City" },
  { value: "SPORT", label: "Sport" },
];

const TYPE_SECTION_LABELS: Record<PreferenceType, string> = {
  ARTIST: "Artists",
  TEAM: "Teams",
  VENUE: "Venues",
  CITY: "Cities",
  SPORT: "Sports",
};

function wordsForSearch(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function suggestionMatchesTypedValue(suggestion: CatalogSuggestion, typedValue: string) {
  const queryWords = wordsForSearch(typedValue);
  if (queryWords.length === 0) return true;

  const candidateWords = [
    suggestion.label,
    suggestion.value,
    suggestion.canonicalName,
    suggestion.subtitle,
    suggestion.address,
    suggestion.city,
    suggestion.region,
    suggestion.country,
    ...(suggestion.aliases ?? []),
  ].flatMap((part) => wordsForSearch(part ?? ""));

  return queryWords.every((queryWord) => candidateWords.some((candidateWord) => candidateWord.startsWith(queryWord)));
}

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

function Body({ user }: { user: MeUser }) {
  const [preferences, setPreferences] = React.useState<Preference[]>([]);
  const [selectedType, setSelectedType] = React.useState<PreferenceType>("ARTIST");
  const [value, setValue] = React.useState("");
  const [selectedSuggestion, setSelectedSuggestion] = React.useState<CatalogSuggestion | null>(null);
  const [suggestions, setSuggestions] = React.useState<CatalogSuggestion[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [requestBusy, setRequestBusy] = React.useState(false);
  const [spotifyLoading, setSpotifyLoading] = React.useState(false);
  const [spotifyConnected, setSpotifyConnected] = React.useState<boolean | null>(null);
  const [spotifyPanelOpen, setSpotifyPanelOpen] = React.useState(false);
  const [spotifyArtists, setSpotifyArtists] = React.useState<SpotifyArtistCandidate[]>([]);
  const [selectedSpotifyIds, setSelectedSpotifyIds] = React.useState<Set<string>>(new Set());
  const [preferenceSectionsOpen, setPreferenceSectionsOpen] = React.useState<Record<PreferenceType, boolean>>({
    ARTIST: true,
    TEAM: true,
    VENUE: true,
    CITY: true,
    SPORT: true,
  });
  const [radiusKm, setRadiusKm] = React.useState(user.notificationRadiusKm ? String(user.notificationRadiusKm) : "");
  const [radiusSaving, setRadiusSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const groupedPreferences = React.useMemo(() => {
    return TYPE_OPTIONS.map((option) => ({
      ...option,
      sectionLabel: TYPE_SECTION_LABELS[option.value],
      items: preferences
        .filter((preference) => preference.type === option.value)
        .slice()
        .sort((a, b) => a.value.localeCompare(b.value, undefined, { sensitivity: "base" })),
    }));
  }, [preferences]);

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
        if (alive) {
          setPreferences(Array.isArray(data.preferences) ? data.preferences : []);
          const loadedRadius = data.settings?.notificationRadiusKm;
          setRadiusKm(Number.isInteger(loadedRadius) ? String(loadedRadius) : "");
        }
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
    const params = new URLSearchParams(window.location.search);
    const spotify = params.get("spotify");
    if (!spotify) return;
    setSpotifyPanelOpen(true);
    if (spotify === "connected") {
      setSpotifyConnected(true);
      setOk("Spotify connected. Find your Spotify artists to import favorites.");
    } else if (spotify === "not_configured") {
      setError("Spotify import is not configured yet.");
    } else if (spotify === "denied") {
      setError("Spotify connection was cancelled.");
    } else {
      setError("Spotify connection failed. Please try again.");
    }
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  React.useEffect(() => {
    let alive = true;
    async function loadSpotifyConnection() {
      try {
        const { res, data } = await fetchJson("/api/integrations/spotify/connection", {
          method: "GET",
          cache: "no-store",
        });
        if (alive && res.ok && data?.ok) setSpotifyConnected(Boolean(data.connected));
      } catch {
        if (alive) setSpotifyConnected(false);
      }
    }

    loadSpotifyConnection();
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
  const visibleSuggestions = React.useMemo(
    () => suggestions.filter((suggestion) => suggestionMatchesTypedValue(suggestion, trimmedValue)),
    [suggestions, trimmedValue]
  );
  const validSelectedSuggestion =
    !!selectedSuggestion &&
    selectedSuggestion.type === selectedType &&
    selectedSuggestion.label === trimmedValue &&
    suggestionMatchesTypedValue(selectedSuggestion, trimmedValue);
  const suggestionToAdd = validSelectedSuggestion ? selectedSuggestion : visibleSuggestions[0] ?? null;
  const canAdd = !!suggestionToAdd && suggestionToAdd.type === selectedType;

  async function addPreference(e: React.FormEvent) {
    e.preventDefault();
    if (!canAdd || !suggestionToAdd) {
      setError("Choose a verified catalog suggestion before adding it.");
      setOk(null);
      return;
    }

    const preferenceValue = (suggestionToAdd.canonicalName ?? suggestionToAdd.value).trim();

    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const { res, data } = await fetchJson("/api/notifications/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: selectedType,
          value: preferenceValue,
          catalogEntityId: suggestionToAdd.catalogEntityId,
        }),
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

  async function requestCatalogAddition() {
    const requestValue = value.trim();
    if (requestValue.length < 2) {
      setError("Type the missing artist, team, venue, or city before requesting an addition.");
      setOk(null);
      return;
    }

    setRequestBusy(true);
    setError(null);
    setOk(null);
    try {
      const { res, data } = await fetchJson("/api/catalog/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: selectedType,
          value: requestValue,
        }),
      });

      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.message || data?.error || "Could not submit catalog request."));
      }

      if (data.alreadyExists && data.preference) {
        const existing = data.preference as Preference;
        setPreferences((prev) => {
          const withoutDuplicate = prev.filter((item) => item.id !== existing.id);
          return [...withoutDuplicate, existing].sort((a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value));
        });
        setOk("That notification preference is already in your list.");
      } else {
        setOk("Request sent. TrueFanTix will research it and add it to your notifications when it is verified.");
      }

      setValue("");
      setSelectedSuggestion(null);
      setSuggestions([]);
    } catch (e: any) {
      setError(e?.message ?? "Could not submit catalog request.");
    } finally {
      setRequestBusy(false);
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

  async function loadSpotifyArtists() {
    setSpotifyLoading(true);
    setError(null);
    setOk(null);
    try {
      const { res, data } = await fetchJson("/api/integrations/spotify/artists", { method: "GET" });
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.message || data?.error || "Could not load Spotify artists."));
      }
      setSpotifyConnected(Boolean(data.connected));
      const artists = Array.isArray(data.artists) ? (data.artists as SpotifyArtistCandidate[]) : [];
      setSpotifyArtists(artists);
      setSelectedSpotifyIds(new Set(artists.map((artist) => artist.spotifyId)));
      setSpotifyPanelOpen(true);
      if (!data.connected) {
        setOk(null);
      } else {
        setOk(`Loaded ${artists.length} Spotify artists.`);
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not load Spotify artists.");
    } finally {
      setSpotifyLoading(false);
    }
  }

  async function importSpotifyArtists() {
    if (selectedSpotifyIds.size === 0) {
      setError("Select at least one Spotify artist to import.");
      setOk(null);
      return;
    }

    setSpotifyLoading(true);
    setError(null);
    setOk(null);
    try {
      const { res, data } = await fetchJson("/api/integrations/spotify/artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyIds: Array.from(selectedSpotifyIds), includeUnmatched: true }),
      });
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.message || data?.error || "Could not import Spotify artists."));
      }

      const imported = Array.isArray(data.imported) ? (data.imported as Preference[]) : [];
      setPreferences((prev) => {
        const byId = new Map(prev.map((item) => [item.id, item]));
        for (const item of imported) byId.set(item.id, item);
        return Array.from(byId.values()).sort((a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value));
      });
      setOk(`Imported ${imported.length} Spotify artist${imported.length === 1 ? "" : "s"} into notifications.`);
      await loadSpotifyArtists();
    } catch (e: any) {
      setError(e?.message ?? "Could not import Spotify artists.");
    } finally {
      setSpotifyLoading(false);
    }
  }

  async function disconnectSpotify() {
    setSpotifyLoading(true);
    setError(null);
    setOk(null);
    try {
      const { res, data } = await fetchJson("/api/integrations/spotify/connection", {
        method: "DELETE",
      });
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.message || data?.error || "Could not disconnect Spotify."));
      }
      setSpotifyConnected(false);
      setSpotifyArtists([]);
      setSelectedSpotifyIds(new Set());
      setOk("Spotify disconnected. Imported notification favorites remain in your list unless you remove them.");
    } catch (e: any) {
      setError(e?.message ?? "Could not disconnect Spotify.");
    } finally {
      setSpotifyLoading(false);
    }
  }

  function toggleSpotifyArtist(id: string) {
    setSelectedSpotifyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllSpotifyArtists() {
    setSelectedSpotifyIds((prev) => {
      if (prev.size === spotifyArtists.length) return new Set();
      return new Set(spotifyArtists.map((artist) => artist.spotifyId));
    });
  }

  function togglePreferenceSection(type: PreferenceType) {
    setPreferenceSectionsOpen((prev) => ({ ...prev, [type]: !prev[type] }));
  }

  async function saveRadius(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = radiusKm.trim();
    const nextRadius = trimmed ? Number(trimmed) : null;
    if (nextRadius !== null && (!Number.isInteger(nextRadius) || nextRadius < 1 || nextRadius > 5000)) {
      setError("Enter a whole-number radius from 1 to 5000 km, or leave it blank for no distance limit.");
      setOk(null);
      return;
    }

    setRadiusSaving(true);
    setError(null);
    setOk(null);
    try {
      const { res, data } = await fetchJson("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationRadiusKm: nextRadius }),
      });
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.message || data?.error || "Could not update notification radius."));
      }
      const savedRadius = data.settings?.notificationRadiusKm;
      setRadiusKm(Number.isInteger(savedRadius) ? String(savedRadius) : "");
      setOk(savedRadius ? `Notification radius saved at ${savedRadius} km from your home address.` : "Notification radius cleared.");
    } catch (e: any) {
      setError(e?.message ?? "Could not update notification radius.");
    } finally {
      setRadiusSaving(false);
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
        Add artists, teams, venues, cities, and sports for alerts and sold-out access matching.
      </div>

      <form
        onSubmit={saveRadius}
        style={{
          marginTop: 14,
          padding: 12,
          borderRadius: 10,
          border: "1px solid rgba(37, 99, 235, 0.18)",
          background: "rgba(239, 246, 255, 0.7)",
          display: "grid",
          gap: 10,
        }}
      >
        <div>
          <div style={{ fontWeight: 950 }}>Event distance radius</div>
          <div style={{ marginTop: 3, fontSize: 13, opacity: 0.78 }}>
            Uses your home address in {user.city}, {user.region} to limit event notifications to places you are willing to travel.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="number"
            min={1}
            max={5000}
            step={1}
            inputMode="numeric"
            value={radiusKm}
            onChange={(e) => setRadiusKm(e.target.value)}
            disabled={radiusSaving}
            placeholder="No limit"
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(148, 163, 184, 0.9)",
              background: "white",
              flex: "1 1 180px",
            }}
          />
          <span style={{ fontSize: 13, opacity: 0.75 }}>km from home</span>
          <button
            type="submit"
            disabled={radiusSaving}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid rgba(37, 99, 235, 0.35)",
              background: radiusSaving ? "rgba(148, 163, 184, 0.18)" : "rgba(37, 99, 235, 1)",
              color: radiusSaving ? "rgba(15,23,42,0.55)" : "white",
              fontWeight: 950,
              cursor: radiusSaving ? "not-allowed" : "pointer",
            }}
          >
            {radiusSaving ? "Saving..." : "Save radius"}
          </button>
        </div>
      </form>

      <div
        style={{
          marginTop: 14,
          padding: 12,
          borderRadius: 10,
          border: "1px solid rgba(30, 215, 96, 0.35)",
          background: "rgba(240, 253, 244, 1)",
          display: "grid",
          gap: 10,
        }}
      >
        <button
          type="button"
          aria-expanded={spotifyPanelOpen}
          onClick={() => setSpotifyPanelOpen((open) => !open)}
          style={{
            width: "100%",
            border: 0,
            background: "transparent",
            padding: 0,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            textAlign: "left",
            cursor: "pointer",
            color: "inherit",
          }}
        >
          <div>
            <div style={{ fontWeight: 950 }}>Import artists from Spotify</div>
            <div style={{ marginTop: 2, fontSize: 13, opacity: 0.75 }}>
              {spotifyConnected
                ? "Spotify connected. Open to find and import artists."
                : "Connect Spotify to import followed/top artists into notification favorites."}
            </div>
          </div>
          <span
            style={{
              padding: "7px 10px",
              borderRadius: 8,
              border: "1px solid rgba(22, 163, 74, 0.28)",
              background: "white",
              fontWeight: 900,
              whiteSpace: "nowrap",
            }}
          >
            {spotifyPanelOpen ? "Hide" : "Show"}
          </span>
        </button>

        {spotifyPanelOpen ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a
              href="/api/integrations/spotify/start"
              style={{
                padding: "9px 11px",
                borderRadius: 8,
                border: "1px solid rgba(22, 163, 74, 0.35)",
                background: "white",
                color: "inherit",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              Connect Spotify
            </a>
            {spotifyConnected ? (
              <>
                <button
                  type="button"
                  onClick={loadSpotifyArtists}
                  disabled={spotifyLoading}
                  style={{
                    padding: "9px 11px",
                    borderRadius: 8,
                    border: "1px solid rgba(0,0,0,0.12)",
                    background: "white",
                    fontWeight: 900,
                    cursor: spotifyLoading ? "not-allowed" : "pointer",
                  }}
                >
                  {spotifyLoading ? "Loading..." : "Find my Spotify artists"}
                </button>
                <button
                  type="button"
                  onClick={disconnectSpotify}
                  disabled={spotifyLoading}
                  style={{
                    padding: "9px 11px",
                    borderRadius: 8,
                    border: "1px solid rgba(220, 38, 38, 0.28)",
                    background: "white",
                    color: "rgba(153, 27, 27, 1)",
                    fontWeight: 900,
                    cursor: spotifyLoading ? "not-allowed" : "pointer",
                  }}
                >
                  Disconnect Spotify
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        {spotifyPanelOpen && spotifyConnected === false ? (
          <div style={{ fontSize: 13, opacity: 0.78 }}>Connect Spotify first to find artists for import.</div>
        ) : null}

        {spotifyPanelOpen && spotifyArtists.length > 0 ? (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ fontSize: 13, opacity: 0.78 }}>
                {selectedSpotifyIds.size} selected · unmatched selections become catalog requests.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={toggleAllSpotifyArtists}
                  disabled={spotifyLoading}
                  style={{
                    padding: "9px 11px",
                    borderRadius: 8,
                    border: "1px solid rgba(15, 23, 42, 0.15)",
                    background: "white",
                    color: "inherit",
                    fontWeight: 950,
                    cursor: spotifyLoading ? "not-allowed" : "pointer",
                  }}
                >
                  {selectedSpotifyIds.size === spotifyArtists.length ? "Deselect all" : "Select all"}
                </button>
                <button
                  type="button"
                  onClick={importSpotifyArtists}
                  disabled={spotifyLoading || selectedSpotifyIds.size === 0}
                  style={{
                    padding: "9px 11px",
                    borderRadius: 8,
                    border: "1px solid rgba(15, 23, 42, 0.15)",
                    background: spotifyLoading || selectedSpotifyIds.size === 0 ? "rgba(148, 163, 184, 0.18)" : "rgba(15, 23, 42, 0.92)",
                    color: spotifyLoading || selectedSpotifyIds.size === 0 ? "rgba(15,23,42,0.55)" : "white",
                    fontWeight: 950,
                    cursor: spotifyLoading || selectedSpotifyIds.size === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  Import selected
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gap: 6, maxHeight: 360, overflow: "auto" }}>
              {spotifyArtists.map((artist) => {
                const checked = selectedSpotifyIds.has(artist.spotifyId);
                return (
                  <label
                    key={artist.spotifyId}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr",
                      gap: 10,
                      alignItems: "center",
                      padding: 10,
                      borderRadius: 8,
                      border: "1px solid rgba(148, 163, 184, 0.45)",
                      background: "white",
                    }}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleSpotifyArtist(artist.spotifyId)} />
                    <span>
                      <span style={{ display: "block", fontWeight: 900 }}>{artist.name}</span>
                      <span style={{ display: "block", marginTop: 2, fontSize: 12, opacity: 0.72 }}>
                        {artist.match
                          ? `Matched to ${artist.match.label}`
                          : "No catalog match yet; will request admin review if selected"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}
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
            disabled={busy || requestBusy}
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
              disabled={busy || requestBusy}
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
                {visibleSuggestions.length > 0 ? (
                  visibleSuggestions.map((suggestion) => {
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
                        disabled={busy || requestBusy}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: 10,
                          borderRadius: 10,
                          border: isSelected
                            ? "1px solid rgba(37, 99, 235, 0.65)"
                            : "1px solid rgba(148, 163, 184, 0.55)",
                          background: isSelected ? "rgba(239, 246, 255, 1)" : "white",
                          cursor: busy || requestBusy ? "not-allowed" : "pointer",
                        }}
                      >
                        <span style={{ display: "block", fontWeight: 950 }}>{suggestion.label}</span>
                        <span style={{ display: "block", marginTop: 2, fontSize: 12, opacity: 0.72 }}>
                          {[suggestion.subtitle ?? suggestion.type, suggestion.provider].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    );
                  })
                ) : selectedSuggestion ? null : (
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
                    <div>No verified catalog match found. Check the spelling or try another term.</div>
                    <button
                      type="button"
                      onClick={requestCatalogAddition}
                      disabled={busy || requestBusy}
                      style={{
                        marginTop: 8,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid rgba(37, 99, 235, 0.35)",
                        background: busy || requestBusy ? "rgba(148, 163, 184, 0.18)" : "rgba(239, 246, 255, 1)",
                        color: "rgba(30, 64, 175, 1)",
                        fontWeight: 900,
                        cursor: busy || requestBusy ? "not-allowed" : "pointer",
                      }}
                    >
                      {requestBusy ? "Sending request..." : `Request this ${selectedType.toLowerCase()}`}
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={busy || requestBusy || !canAdd}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.12)",
              background: busy || requestBusy || !canAdd ? "rgba(148, 163, 184, 0.18)" : "rgba(15, 23, 42, 0.92)",
              color: busy || requestBusy || !canAdd ? "rgba(15,23,42,0.55)" : "white",
              fontWeight: 950,
              cursor: busy || requestBusy || !canAdd ? "not-allowed" : "pointer",
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

        {groupedPreferences.map((group) => {
          if (group.items.length === 0) return null;
          const isOpen = preferenceSectionsOpen[group.value];
          return (
            <section
              key={group.value}
              style={{
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.10)",
                background: "rgba(248, 250, 252, 1)",
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => togglePreferenceSection(group.value)}
                style={{
                  width: "100%",
                  padding: 12,
                  border: 0,
                  background: "white",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  color: "inherit",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ fontWeight: 950 }}>
                  {group.sectionLabel} ({group.items.length})
                </span>
                <span style={{ fontSize: 13, fontWeight: 900, opacity: 0.72 }}>{isOpen ? "Hide" : "Show"}</span>
              </button>

              {isOpen ? (
                <div style={{ display: "grid", gap: 8, padding: 10 }}>
                  {group.items.map((preference) => (
                    <div
                      key={preference.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        padding: 10,
                        borderRadius: 8,
                        border: "1px solid rgba(0,0,0,0.08)",
                        background: "white",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 950 }}>{preference.value}</div>
                        <div style={{ fontSize: 12, opacity: 0.72 }}>{preference.status}</div>
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
                  ))}
                </div>
              ) : null}
            </section>
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
        {(user) => <Body user={user} />}
      </AccountGate>
    </Shell>
  );
}
