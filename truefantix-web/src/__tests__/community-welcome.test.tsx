import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CommunityWelcome from "@/app/_components/community-welcome";
import { LanguageProvider } from "@/app/_components/language-provider";

const mockUsePathname = jest.fn(() => "/");

jest.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

describe("CommunityWelcome", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    mockUsePathname.mockReturnValue("/");
  });

  it("welcomes a new visitor on the home page", async () => {
    render(<CommunityWelcome />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("We're building this with fans like you")).toBeInTheDocument();
    expect(screen.getByText(/isn't a marketplace for scalpers/i)).toBeInTheDocument();
    expect(screen.getByText(/4 access tokens for every ticket you sell/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to site" })).toBeInTheDocument();
  });

  it("stays out of the way after the visitor continues", async () => {
    render(<CommunityWelcome />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue to site" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(window.sessionStorage.getItem("tft_community_welcome_seen")).toBe("1");
  });

  it("does not appear away from the home page", async () => {
    mockUsePathname.mockReturnValue("/tickets");
    render(<CommunityWelcome />);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("lets a visitor read the welcome in French and remembers the choice", async () => {
    render(
      <LanguageProvider>
        <CommunityWelcome />
      </LanguageProvider>,
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "FR" }));

    expect(await screen.findByText("Nous bâtissons ceci avec des amateurs comme vous")).toBeInTheDocument();
    expect(screen.getByText(/n’est pas une plateforme pour les revendeurs/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuer vers le site" })).toBeInTheDocument();
    expect(window.localStorage.getItem("truefantix-language")).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
  });
});
