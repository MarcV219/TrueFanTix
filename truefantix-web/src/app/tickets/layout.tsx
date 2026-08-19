import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Browse Verified Event Tickets",
  description: "Browse verified concert, sports, theatre, comedy, and other event tickets listed at or below face value on TrueFanTix.",
  alternates: { canonical: "/tickets" },
  openGraph: {
    url: "/tickets",
    title: "Browse Verified Event Tickets | TrueFanTix",
    description: "Find verified event tickets listed by fans at or below face value.",
  },
};

export default function TicketsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
