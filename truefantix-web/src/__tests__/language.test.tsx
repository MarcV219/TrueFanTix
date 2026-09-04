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

  it("translates homepage promotion and dynamic forum labels", () => {
    expect(translateText("Welcome to", "fr")).toBe("Bienvenue sur");
    expect(translateText("Updated Sep 4, 2026", "fr")).toBe("Mis à jour Sep 4, 2026");
    expect(translateText("0 replies", "fr")).toBe("0 réponses");
    expect(translateText("1 reply", "fr")).toBe("1 réponse");
    expect(translateText(
      "Create your free account and receive 4 access tokens. Sell tickets during the promotion and earn an additional 4 access tokens for every ticket sold.",
      "fr",
    )).toContain("Créez votre compte gratuit");
  });

  it("translates the TrueFanTix forum welcome content and forum metadata", () => {
    expect(translateText("TrueFanTix Community", "fr")).toBe("Communauté TrueFanTix");
    expect(translateText(
      "Welcome to the TrueFanTix Community — You're Here at the Beginning",
      "fr",
    )).toBe("Bienvenue dans la communauté TrueFanTix — Vous êtes là depuis le début");
    expect(translateText("3 posts", "fr")).toBe("3 publications");
    expect(translateText("by Marc", "fr")).toBe("par Marc");
  });

  it.each([
    ["Built by a fan, for fans", "Créé par un amateur, pour les amateurs"],
    ["For Sellers", "Pour les vendeurs"],
    ["One core rule: Tickets at or below face value", "Une règle fondamentale : les billets au prix nominal ou moins"],
    ["Trust is built into the platform", "La confiance est intégrée à la plateforme"],
    ["Are ticket prices fair?", "Les prix des billets sont-ils équitables?"],
    ["What is the refund policy?", "Quelle est la politique de remboursement?"],
    ["Your privacy matters to us", "Votre vie privée nous tient à cœur"],
    ["Agreement to Terms", "Acceptation des conditions"],
    ["Pricing and Fee Policy", "Politique de tarification et de frais"],
    ["Help us build a positive community for fans", "Aidez-nous à bâtir une communauté positive pour les amateurs"],
    ["Found a bug or something broken? Send us details and we'll jump on it.", "Vous avez trouvé un bogue ou un élément défectueux? Envoyez-nous les détails et nous nous en occuperons."],
  ])("translates public information copy: %s", (english, french) => {
    expect(translateText(english, "fr")).toBe(french);
  });
});
