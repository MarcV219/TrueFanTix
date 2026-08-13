import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SellerReview, type Ticket } from "@/app/account/tickets/bought/page";
import { apiFetch } from "@/lib/api-fetch";

jest.mock("@/lib/api-fetch", () => ({ apiFetch: jest.fn() }));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "ticket-1",
    title: "The Black Keys",
    venue: "Test Venue",
    date: "2026-09-01T20:00:00.000Z",
    price: 25,
    image: "",
    status: "SOLD",
    orderId: "order-1",
    orderDate: "2026-08-13T12:00:00.000Z",
    qrCodeUrl: "/api/tickets/ticket-1/qr",
    seller: { id: "seller-1", name: "Marc Seller" },
    review: null,
    ...overrides,
  };
}

describe("completed-order seller review", () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it("submits the chosen star rating and buyer comments", async () => {
    const user = userEvent.setup();
    const onSubmitted = jest.fn();
    mockedApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        review: { id: "review-1", rating: 2, content: "Tickets arrived late.", createdAt: "2026-08-13T12:30:00.000Z" },
      }),
    } as Response);

    render(<SellerReview ticket={ticket()} onSubmitted={onSubmitted} />);
    await user.click(screen.getByRole("radio", { name: "2 stars" }));
    await user.type(screen.getByLabelText("Comments"), "Tickets arrived late.");
    await user.click(screen.getByRole("button", { name: "Submit seller review" }));

    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(1));
    expect(mockedApiFetch).toHaveBeenCalledWith("/api/reviews", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ orderId: "order-1", rating: 2, content: "Tickets arrived late." }),
    }));
    expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ id: "review-1", rating: 2 }));
  });

  it("shows an existing review instead of allowing a duplicate", () => {
    render(
      <SellerReview
        ticket={ticket({ review: { id: "review-1", rating: 5, content: "Perfect transfer.", createdAt: "2026-08-13T12:30:00.000Z" } })}
        onSubmitted={jest.fn()}
      />
    );

    expect(screen.getByText("Your review of Marc Seller")).toBeTruthy();
    expect(screen.getByText("Perfect transfer.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Submit seller review" })).toBeNull();
  });
});
