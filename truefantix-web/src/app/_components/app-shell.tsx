"use client";

import React from "react";
import { usePathname } from "next/navigation";

import AppHeader from "@/app/_components/appheader";
import { NavHistoryProvider } from "@/app/_components/navhistory";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";

  // Keep the Coming Soon page clean/minimal.
  const hideHeader = pathname === "/coming-soon";

  return (
    <NavHistoryProvider>
      {!hideHeader ? <AppHeader /> : null}
      {children}
    </NavHistoryProvider>
  );
}
