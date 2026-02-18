"use client";

import React, { useState } from "react";
import Link from "next/link";
import AccountGate, { MeUser } from "@/app/account/_components/accountgate";

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
          <Link href="/verify" style={{ textDecoration: "underline" }}>
            Verify
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>{children}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 10,
  border: "1px solid rgba(148, 163, 184, 0.9)",
  background: "rgba(248, 250, 252, 1)",
  color: "rgba(15, 23, 42, 1)",
  outline: "none",
  fontSize: 14,
};

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  fontSize: 14,
};

const buttonPrimary: React.CSSProperties = {
  padding: "12px 24px",
  borderRadius: 10,
  border: "1px solid rgba(37, 99, 235, 0.35)",
  background: "rgba(37, 99, 235, 1)",
  color: "white",
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 14,
};

const buttonSecondary: React.CSSProperties = {
  padding: "12px 24px",
  borderRadius: 10,
  border: "1px solid rgba(0,0,0,0.18)",
  background: "rgba(248, 250, 252, 1)",
  color: "rgba(15, 23, 42, 1)",
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 14,
};

async function fetchJson(path: string, init?: RequestInit) {
  const res = await fetch(path, init);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { res, data, text };
}

function ProfileEditor({ me, onUpdated }: { me: MeUser; onUpdated: (user: MeUser) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    firstName: me.firstName || "",
    lastName: me.lastName || "",
    displayName: me.displayName || "",
    phone: me.phone || "",
    streetAddress1: me.streetAddress1 || "",
    streetAddress2: me.streetAddress2 || "",
    city: me.city || "",
    region: me.region || "",
    postalCode: me.postalCode || "",
    country: me.country || "Canada",
  });

  const handleChange = (field: keyof typeof formData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError(null);
    setSuccess(null);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    const { res, data } = await fetchJson("/api/account/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });

    setIsSaving(false);

    if (!res.ok) {
      const message = data?.message || "Failed to update profile.";
      setError(message);
      return;
    }

    setSuccess("Profile updated successfully!");
    onUpdated(data.user);
    setIsEditing(false);
  };

  const handleCancel = () => {
    // Reset form to current values
    setFormData({
      firstName: me.firstName || "",
      lastName: me.lastName || "",
      displayName: me.displayName || "",
      phone: me.phone || "",
      streetAddress1: me.streetAddress1 || "",
      streetAddress2: me.streetAddress2 || "",
      city: me.city || "",
      region: me.region || "",
      postalCode: me.postalCode || "",
      country: me.country || "Canada",
    });
    setError(null);
    setSuccess(null);
    setIsEditing(false);
  };

  const displayName = me?.displayName?.trim() || `${me.firstName} ${me.lastName}`;

  if (isEditing) {
    return (
      <div
        style={{
          padding: 20,
          borderRadius: 12,
          border: "1px solid rgba(0,0,0,0.10)",
          background: "white",
        }}
      >
        <div style={{ fontWeight: 950, fontSize: 18, marginBottom: 16 }}>Edit Profile</div>

        {error && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(255,0,0,0.35)",
              background: "rgba(254, 242, 242, 1)",
              color: "rgba(153, 27, 27, 1)",
            }}
          >
            {error}
          </div>
        )}

        {success && (
          <div
            role="status"
            style={{
              marginBottom: 16,
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(34, 197, 94, 0.35)",
              background: "rgba(240, 253, 244, 1)",
              color: "rgba(22, 101, 52, 1)",
            }}
          >
            {success}
          </div>
        )}

        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={labelStyle}>
              <span>First name *</span>
              <input
                type="text"
                value={formData.firstName}
                onChange={(e) => handleChange("firstName", e.target.value)}
                style={inputStyle}
                disabled={isSaving}
              />
            </label>

            <label style={labelStyle}>
              <span>Last name *</span>
              <input
                type="text"
                value={formData.lastName}
                onChange={(e) => handleChange("lastName", e.target.value)}
                style={inputStyle}
                disabled={isSaving}
              />
            </label>
          </div>

          <label style={labelStyle}>
            <span>Display name (optional)</span>
            <input
              type="text"
              value={formData.displayName}
              onChange={(e) => handleChange("displayName", e.target.value)}
              style={inputStyle}
              disabled={isSaving}
              placeholder="How you appear to other users"
            />
          </label>

          <label style={labelStyle}>
            <span>Phone *</span>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => handleChange("phone", e.target.value)}
              style={inputStyle}
              disabled={isSaving}
              placeholder="+1 705 555 0123"
            />
            <span style={{ fontSize: 12, opacity: 0.7 }}>
              Changing your phone will require re-verification.
            </span>
          </label>

          <div style={{ height: 1, background: "rgba(0,0,0,0.08)", margin: "8px 0" }} />

          <label style={labelStyle}>
            <span>Street address *</span>
            <input
              type="text"
              value={formData.streetAddress1}
              onChange={(e) => handleChange("streetAddress1", e.target.value)}
              style={inputStyle}
              disabled={isSaving}
            />
          </label>

          <label style={labelStyle}>
            <span>Street address 2 (optional)</span>
            <input
              type="text"
              value={formData.streetAddress2}
              onChange={(e) => handleChange("streetAddress2", e.target.value)}
              style={inputStyle}
              disabled={isSaving}
              placeholder="Apt, suite, unit, etc."
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={labelStyle}>
              <span>City *</span>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => handleChange("city", e.target.value)}
                style={inputStyle}
                disabled={isSaving}
              />
            </label>

            <label style={labelStyle}>
              <span>Province/State *</span>
              <input
                type="text"
                value={formData.region}
                onChange={(e) => handleChange("region", e.target.value)}
                style={inputStyle}
                disabled={isSaving}
              />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={labelStyle}>
              <span>Postal/ZIP code *</span>
              <input
                type="text"
                value={formData.postalCode}
                onChange={(e) => handleChange("postalCode", e.target.value)}
                style={inputStyle}
                disabled={isSaving}
              />
            </label>

            <label style={labelStyle}>
              <span>Country *</span>
              <input
                type="text"
                value={formData.country}
                onChange={(e) => handleChange("country", e.target.value)}
                style={inputStyle}
                disabled={isSaving}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            <button
              onClick={handleSave}
              disabled={isSaving}
              style={{
                ...buttonPrimary,
                opacity: isSaving ? 0.6 : 1,
                cursor: isSaving ? "not-allowed" : "pointer",
              }}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
            <button
              onClick={handleCancel}
              disabled={isSaving}
              style={buttonSecondary}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 20,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "white",
      }}
    >
      <div style={{ fontWeight: 950, fontSize: 18, marginBottom: 16 }}>Profile Details</div>

      {success && (
        <div
          role="status"
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            border: "1px solid rgba(34, 197, 94, 0.35)",
            background: "rgba(240, 253, 244, 1)",
            color: "rgba(22, 101, 52, 1)",
          }}
        >
          {success}
        </div>
      )}

      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Display name</div>
          <div style={{ fontWeight: 700 }}>{displayName}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>First name</div>
          <div>{me.firstName}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Last name</div>
          <div>{me.lastName}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Email</div>
          <div>{me.email}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Phone</div>
          <div>{me.phone}</div>
        </div>

        <div style={{ height: 1, background: "rgba(0,0,0,0.08)", margin: "4px 0" }} />

        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Address</div>
          <div>
            {me.streetAddress1}
            {me.streetAddress2 && <>, {me.streetAddress2}</>}
            <br />
            {me.city}, {me.region} {me.postalCode}
            <br />
            {me.country}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <button onClick={() => setIsEditing(true)} style={buttonPrimary}>
          Edit Profile
        </button>
      </div>
    </div>
  );
}

export default function AccountProfilePage() {
  const [user, setUser] = useState<MeUser | null>(null);

  return (
    <Shell title="Profile">
      <AccountGate
        nextPath="/account/profile"
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
        {(me) => <ProfileEditor me={user || me} onUpdated={setUser} />}
      </AccountGate>
    </Shell>
  );
}
