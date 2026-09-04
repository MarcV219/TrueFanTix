import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider, LanguageSwitch } from "@/app/_components/language-provider";
import { translateText } from "@/lib/language";

let pathname = "/tickets";

jest.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

describe("customer language preference", () => {
  beforeEach(() => {
    pathname = "/tickets";
    window.localStorage.clear();
    document.documentElement.lang = "en";
  });

  it("defaults to English and persists a French selection", async () => {
    render(
      <LanguageProvider>
        <LanguageSwitch />
        <p>Buy tickets</p>
      </LanguageProvider>,
    );

    expect(screen.getByText("Buy tickets")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "FR" }));

    await waitFor(() => expect(screen.getByText("Acheter des billets")).toBeInTheDocument());
    expect(window.localStorage.getItem("truefantix-language")).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
  });

  it("keeps admin pages in English without erasing the preference", async () => {
    window.localStorage.setItem("truefantix-language", "fr");
    pathname = "/admin";
    render(
      <LanguageProvider>
        <p>Buy tickets</p>
      </LanguageProvider>,
    );

    await act(async () => undefined);
    expect(screen.getByText("Buy tickets")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(window.localStorage.getItem("truefantix-language")).toBe("fr");
  });

  it("translates common navigation and generated back labels", () => {
    expect(translateText("Account", "fr")).toBe("Compte");
    expect(translateText("Back to Tickets", "fr")).toBe("Retour à Billets");
    expect(translateText("Account", "en")).toBe("Account");
  });
});
