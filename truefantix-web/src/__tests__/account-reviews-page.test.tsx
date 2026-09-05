import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewsBody } from "@/app/account/reviews/page";
import { LanguageProvider, LanguageSwitch } from "@/app/_components/language-provider";
import { fetchJson } from "@/lib/api-fetch";

jest.mock("@/lib/api-fetch", () => ({ fetchJson: jest.fn() }));

const mockedFetchJson = fetchJson as jest.MockedFunction<typeof fetchJson>;

describe("account reviews page", () => {
  beforeEach(() => mockedFetchJson.mockReset());

  it("highlights completed purchases waiting for a buyer review and shows both histories", async () => {
    mockedFetchJson.mockResolvedValue({
      res: { ok: true } as Response,
      text: "",
      data: {
        ok: true,
        reviews: {
          pending: [{
            id: "order-1",
            createdAt: "2026-08-13T12:00:00.000Z",
            seller: { id: "seller-1", name: "Marc Seller" },
            items: [{
              priceCents: 100,
              ticket: { id: "ticket-1", title: "The Black Keys", venue: "Test Venue", date: "2026-09-01", image: "", status: "SOLD" },
            }],
          }],
          received: [{
            id: "received-1", rating: 5, content: "Excellent seller.", status: "APPROVED", createdAt: "2026-08-13T12:00:00.000Z",
            reviewer: { id: "buyer-1", firstName: "Pam", displayName: "Pam Buyer" },
            order: { id: "order-2", items: [{ ticket: { title: "Concert Two" } }] },
          }],
          written: [{
            id: "written-1", rating: 4, content: "Smooth delivery.", status: "APPROVED", createdAt: "2026-08-13T12:00:00.000Z",
            seller: { id: "seller-2", name: "Taylor Seller" },
            order: { id: "order-3", items: [{ ticket: { title: "Concert Three" } }] },
          }],
        },
      },
    });

    render(<ReviewsBody />);

    expect(await screen.findByText("Review needed")).toBeTruthy();
    expect(screen.getByText("The Black Keys")).toBeTruthy();
    expect(screen.getByText("Excellent seller.")).toBeTruthy();
    expect(screen.getByText("Smooth delivery.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit seller review" })).toBeTruthy();
    await waitFor(() => expect(mockedFetchJson).toHaveBeenCalledWith("/api/account/reviews", { cache: "no-store" }));
  });

  it("switches customer review content from English to French and back again", async () => {
    mockedFetchJson.mockImplementation(async (path) => {
      if (path === "/api/account/reviews/translations") {
        return {
          res: { ok: true } as Response,
          text: "",
          data: { ok: true, translations: { "received-1": "Livraison rapide des billets!" } },
        };
      }
      return {
        res: { ok: true } as Response,
        text: "",
        data: {
          ok: true,
          reviews: {
            pending: [], written: [],
            received: [{
              id: "received-1", rating: 5, content: "Quick delivery of tickets!", status: "APPROVED",
              createdAt: "2026-08-13T12:00:00.000Z",
              reviewer: { id: "buyer-1", firstName: "Pam", displayName: "Pam" },
              order: { id: "order-2", items: [{ ticket: { title: "The Black Keys" } }] },
            }],
          },
        },
      };
    });

    const { container } = render(<LanguageProvider><LanguageSwitch /><ReviewsBody /></LanguageProvider>);
    expect(await screen.findByText("Quick delivery of tickets!")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "FR" }));
    expect(await screen.findByText("Livraison rapide des billets!")).toBeInTheDocument();
    expect(container.querySelector("article > p[data-no-translate]")?.textContent).toBe("Livraison rapide des billets!");

    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(await screen.findByText("Quick delivery of tickets!")).toBeInTheDocument();
    expect(container.querySelector("article > p[data-no-translate]")?.textContent).toBe("Quick delivery of tickets!");

    fireEvent.click(screen.getByRole("button", { name: "FR" }));
    expect(await screen.findByText("Livraison rapide des billets!")).toBeInTheDocument();
  });
});
