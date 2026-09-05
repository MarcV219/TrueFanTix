import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider, LanguageSwitch, useLanguage } from "@/app/_components/language-provider";
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

  it("translates customer text that changes after an async status update", async () => {
    function LiveStatus() {
      const [ready, setReady] = React.useState(false);
      return <><button onClick={() => setReady(true)}>update</button><p>{ready ? "Seller verified" : "Starting verification…"}</p></>;
    }

    render(<LanguageProvider><LanguageSwitch /><LiveStatus /></LanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: "FR" }));
    await waitFor(() => expect(screen.getByText("Démarrage de la vérification…")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "update" }));
    await waitFor(() => expect(screen.getByText("Vendeur vérifié")).toBeInTheDocument());
  });

  it("restores English for components that render their own localized dynamic text", async () => {
    function DynamicNotificationCopy() {
      const { language } = useLanguage();
      return (
        <>
          <p>{language === "fr"
            ? "Utilise votre adresse domiciliaire à Midhurst, ON pour limiter les notifications aux événements situés dans les endroits où vous êtes prêt à vous déplacer."
            : "Uses your home address in Midhurst, ON to limit event notifications to places you are willing to travel."}</p>
          <input placeholder={language === "fr" ? "Commencez à saisir un artiste..." : "Start typing a artist..."} />
        </>
      );
    }

    render(<LanguageProvider><LanguageSwitch /><DynamicNotificationCopy /></LanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: "FR" }));
    await waitFor(() => expect(screen.getByText(/Utilise votre adresse domiciliaire/)).toBeInTheDocument());
    expect(screen.getByPlaceholderText("Commencez à saisir un artiste...")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await waitFor(() => expect(screen.getByText(/Uses your home address/)).toBeInTheDocument());
    expect(screen.getByPlaceholderText("Start typing a artist...")).toBeInTheDocument();
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

  it("translates the complete ticket-browsing controls and live totals", () => {
    expect(translateText("Find tickets at or below face value for your favorite events", "fr")).toBe("Trouvez des billets au prix nominal ou moins pour vos événements préférés");
    expect(translateText("Search events, venues, artists, teams, shows, towns or cities...", "fr")).toContain("Rechercher des événements");
    expect(translateText("⭐ Sold Out Events Only", "fr")).toBe("⭐ Événements à guichets fermés seulement");
    expect(translateText("0 events • 0 tickets available", "fr")).toBe("0 événements • 0 billets disponibles");
    expect(translateText("2 events • 1 ticket available", "fr")).toBe("2 événements • 1 billet disponible");
    expect(translateText("0 selected · $0.00 CAD subtotal", "fr")).toBe("0 sélectionnés · sous-total de $0.00 CAD");
    expect(translateText("Checkout selected", "fr")).toBe("Passer à la caisse avec la sélection");
    expect(translateText("Back to Home", "fr")).toBe("Retour à l’accueil");
  });

  it("translates every visible login-page instruction", () => {
    expect(translateText("email@example.com or 4165551234", "fr")).toBe("courriel@exemple.ca ou 4165551234");
    expect(translateText("If your account isn’t verified yet, you’ll be sent to verification after login.", "fr")).toContain("dirigé vers la vérification");
    expect(translateText("New here?", "fr")).toBe("Nouveau ici?");
  });

  it("translates dynamic notification guidance for every saved location and interest type", () => {
    expect(translateText(
      "Uses your home address in Midhurst, ON to limit event notifications to places you are willing to travel.",
      "fr",
    )).toContain("votre adresse domiciliaire à Midhurst, ON");
    expect(translateText("Start typing a artist...", "fr")).toBe("Commencez à saisir un artiste...");
    expect(translateText("Start typing a venue...", "fr")).toBe("Commencez à saisir une salle...");
    expect(translateText("Request this team", "fr")).toBe("Demander l’ajout de cette équipe");
  });

  it.each([
    ["Your identity and verification status.", "Votre identité et votre état de vérification."],
    ["Seller verification", "Vérification du vendeur"],
    ["You’re approved to sell.", "Vous êtes autorisé à vendre."],
    ["Seller payout speed", "Vitesse des versements au vendeur"],
    ["Account tools", "Outils du compte"],
    ["Holding (incoming / transferred to you)", "Billets détenus (entrants ou transférés à vous)"],
    ["Selling (active listings)", "En vente (annonces actives)"],
    ["Seller holding (transfer required)", "Billets vendus détenus (transfert requis)"],
    ["Danger zone", "Zone dangereuse"],
    ["Delete my account", "Supprimer mon compte"],
  ])("translates main Account page copy: %s", (english, french) => {
    expect(translateText(english, "fr")).toBe(french);
  });

  it("translates the TrueFanTix forum welcome content and forum metadata", () => {
    expect(translateText("TrueFanTix Community", "fr")).toBe("Communauté TrueFanTix");
    expect(translateText(
      "Welcome to the TrueFanTix Community — You're Here at the Beginning",
      "fr",
    )).toBe("Bienvenue dans la communauté TrueFanTix — Vous êtes là depuis le début");
    expect(translateText("3 posts", "fr")).toBe("3 publications");
    expect(translateText("by Marc", "fr")).toBe("par Marc");
    expect(translateText("From Pam", "fr")).toBe("De la part de Pam");
    expect(translateText("For Taylor", "fr")).toBe("Pour Taylor");
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
