import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider, LanguageSwitch } from "@/app/_components/language-provider";
import ForumThreadTitle from "@/app/forum/_components/forum-thread-title";
import { fetchJson } from "@/lib/api-fetch";

jest.mock("next/navigation", () => ({ usePathname: () => "/forum" }));
jest.mock("@/lib/api-fetch", () => ({ fetchJson: jest.fn() }));

const mockedFetchJson = jest.mocked(fetchJson);

describe("forum content translation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedFetchJson.mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      return {
        res: { ok: true } as Response,
        data: {
          ok: true,
          threadTitles: {
            welcome: body.language === "fr" ? "Un titre entièrement traduit" : "A fully translated title",
          },
        },
      };
    });
  });

  it("switches a forum title to French and back to English", async () => {
    render(
      <LanguageProvider>
        <LanguageSwitch />
        <ForumThreadTitle threadId="welcome" title="A fully translated title" />
      </LanguageProvider>,
    );

    await waitFor(() => expect(screen.getByText("A fully translated title")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "FR" }));
    await waitFor(() => expect(screen.getByText("Un titre entièrement traduit")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await waitFor(() => expect(screen.getByText("A fully translated title")).toBeInTheDocument());
  });
});
