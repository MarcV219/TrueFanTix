type VenueLocation = {
  city?: string | null;
  province?: string | null;
  country?: string | null;
  venue?: string | null;
};

function normalizeKey(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]/g, "");
}

function venueTimeZone(location: VenueLocation): string {
  const city = normalizeKey(location.city);
  const province = String(location.province || "").toUpperCase();
  const country = String(location.country || "");
  const venue = String(location.venue || "").toLowerCase();

  if (["losangeles", "seattle", "vancouver"].includes(city) || venue.includes("los angeles") || venue.includes("seattle") || venue.includes("vancouver")) {
    return "America/Los_Angeles";
  }
  if (["denver", "calgary", "edmonton"].includes(city) || province === "AB" || venue.includes("denver") || venue.includes("calgary") || venue.includes("edmonton")) {
    return "America/Denver";
  }
  if (["chicago", "austin"].includes(city) || province === "IL" || province === "TX" || venue.includes("chicago") || venue.includes("austin")) {
    return "America/Chicago";
  }
  if (["lasvegas"].includes(city) || province === "NV" || venue.includes("las vegas")) {
    return "America/Los_Angeles";
  }
  if (
    ["newyork", "boston", "miami", "ottawa", "toronto", "montreal", "orchardpark"].includes(city) ||
    venue.includes("new york") ||
    venue.includes("boston") ||
    venue.includes("miami") ||
    venue.includes("ottawa") ||
    venue.includes("toronto") ||
    venue.includes("montreal") ||
    venue.includes("montréal") ||
    venue.includes("orchard park")
  ) {
    return "America/Toronto";
  }

  if (country === "USA") return "America/New_York";
  return "America/Toronto";
}

function localNowParts(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    minuteOfDay: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function parseEventLocalParts(rawDate: string | null | undefined): { ymd: string; minuteOfDay: number } | null {
  const value = String(rawDate || "").trim();
  if (!value) return null;

  const ymdMatch = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!ymdMatch) return null;

  let minuteOfDay = 23 * 60 + 59;
  const timeMatch = value.match(/(?:T|\s)(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] || "0");
    const meridiem = timeMatch[3]?.toUpperCase();

    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      minuteOfDay = hour * 60 + minute;
    }
  }

  return {
    ymd: `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`,
    minuteOfDay,
  };
}

export function isTicketEventExpired(
  ticket: { date?: string | null; venue?: string | null; city?: string | null; province?: string | null; country?: string | null },
  now = new Date()
) {
  const event = parseEventLocalParts(ticket.date);
  if (!event) return false;

  const current = localNowParts(venueTimeZone(ticket), now);
  if (event.ymd < current.ymd) return true;
  if (event.ymd > current.ymd) return false;
  return event.minuteOfDay <= current.minuteOfDay;
}
