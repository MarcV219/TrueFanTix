"use client";

import React from "react";
import { usePathname } from "next/navigation";

type NavHistoryValue = {
  previousPath: string | null;
  currentPath: string | null;
};

const NavHistoryContext = React.createContext<NavHistoryValue>({
  previousPath: null,
  currentPath: null,
});

/**
 * NavHistoryProvider:
 * Tracks the previous in-app pathname so we can display
 * "Back to X" labels without guessing.
 */
export function NavHistoryProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = React.useState<NavHistoryValue>({
    previousPath: null,
    currentPath: null,
  });

  React.useEffect(() => {
    setState((prev) => {
      const nextCurrent = pathname ?? null;
      // Only update when pathname is available and actually changed
      if (!nextCurrent || prev.currentPath === nextCurrent) return prev;
      return {
        previousPath: prev.currentPath,
        currentPath: nextCurrent,
      };
    });
  }, [pathname]);

  return <NavHistoryContext.Provider value={state}>{children}</NavHistoryContext.Provider>;
}

export function useNavHistory() {
  return React.useContext(NavHistoryContext);
}
