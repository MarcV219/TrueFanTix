"use client";

import React from "react";
import { usePathname } from "next/navigation";

import AppHeader from "@/app/_components/appheader";
import CommunityWelcome from "@/app/_components/community-welcome";
import { NavHistoryProvider } from "@/app/_components/navhistory";
import TrafficTracker from "@/app/_components/traffic-tracker";
import { LanguageProvider } from "@/app/_components/language-provider";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";

  // Keep the Coming Soon page clean/minimal.
  const hideHeader = pathname === "/coming-soon";

  return (
    <LanguageProvider>
      <NavHistoryProvider>
        <TrafficTracker />
        {!hideHeader ? <AppHeader /> : null}
        {children}
        <CommunityWelcome />
      </NavHistoryProvider>
    </LanguageProvider>
  );
}
