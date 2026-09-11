import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPrimaryStagingConsoleGate } from "@/lib/primary/staging-console";
import PrimaryStagingConsole from "./primary-staging-console";

export const metadata: Metadata = {
  title: "Primary ticketing staging console",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function PrimaryStagingPage() {
  if (!getPrimaryStagingConsoleGate().ready) notFound();
  return <PrimaryStagingConsole />;
}
