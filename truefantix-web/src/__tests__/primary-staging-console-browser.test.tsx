import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PrimaryStagingConsole from "@/app/staging/primary/primary-staging-console";

const organizer = {
  id: "organizer-user",
  email: "organizer@primary-staging.example.invalid",
  firstName: "Staging",
  lastName: "Organizer",
  role: "USER" as const,
};
const admin = { ...organizer, id: "admin-user", email: "admin@primary-staging.example.invalid", lastName: "Reviewer", role: "ADMIN" as const };

function response(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe("primary staging organizer browser flow", () => {
  beforeEach(() => {
    document.cookie = "tft_csrf=browser-test-csrf";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("requires the console token, enters only the synthetic organizer persona, and exposes the workflow", async () => {
    const fetchMock = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(response({ ok: true, actor: null }))
      .mockResolvedValueOnce(response({ ok: true, actor: organizer }))
      .mockResolvedValueOnce(response({
        ok: true,
        actor: organizer,
        organizers: [{
          id: "primary-org-1",
          displayName: "Synthetic Events",
          legalName: "Synthetic Events Ontario Inc.",
          status: "DRAFT",
          statusReason: null,
          supportEmail: "support@primary-staging.example.invalid",
          createdAt: "2026-09-11T18:00:00.000Z",
          memberships: [{ id: "membership-1", userId: organizer.id, role: "OWNER", status: "ACTIVE" }],
          events: [],
        }],
        audit: [],
      }));
    const user = userEvent.setup();

    render(<PrimaryStagingConsole />);

    const token = await screen.findByLabelText("Staging access token");
    const enter = screen.getByRole("button", { name: "Use organizer" });
    expect(enter).toBeDisabled();

    await user.type(token, "staging-access-token-that-is-longer-than-thirty-two-characters");
    await user.click(enter);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Signed in as organizer@primary-staging.example.invalid.",
    );
    expect(screen.getByRole("heading", { name: "1. Create organizer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2. Create draft event" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "3. Add general-admission ticket type" })).toBeInTheDocument();
    expect(screen.getByText("Synthetic Events")).toBeInTheDocument();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/staging/primary/session",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-csrf-token": "browser-test-csrf",
          "x-primary-staging-access-token": "staging-access-token-that-is-longer-than-thirty-two-characters",
        }),
        body: JSON.stringify({ persona: "organizer" }),
      }),
    ]);
  });

  it("shows a fail-closed server error without exposing workflow controls", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(response({ ok: false, error: "NOT_FOUND" }, false));

    render(<PrimaryStagingConsole />);

    expect(await screen.findByText("NOT_FOUND")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "1. Create organizer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Workflow state" })).not.toBeInTheDocument();
  });

  it("shows checked-in supervisor evidence controls and sends the scoped approval command", async () => {
    const checkedEvent = {
      id: "staging-refund-g1-checked-event", title: "Synthetic Refund Console / Checked-in supervised refund", status: "APPROVED",
      orders: [{ id: "checked-order", grossTotalMinor: 3120, currency: "CAD", admissionTickets: [{ id: "checked-ticket", unitNumber: 1, status: "CHECKED_IN", voidReason: null, revocations: [], refundItems: [{ refundId: "refund-1", requestedMinor: 3120, refund: { status: "REQUESTED", reason: "Synthetic", attempts: [], checkedInApprovals: [] } }] }] }],
      cancellations: [],
    };
    const state = { ok: true, actor: admin, organizers: [], audit: [], refundConsole: { generation: 1, organizerId: "refund-organizer", events: [checkedEvent], audit: [] } };
    const fetchMock = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(response({ ok: true, actor: admin }))
      .mockResolvedValueOnce(response(state))
      .mockResolvedValueOnce(response({ ok: true, result: { status: "REQUESTED" } }))
      .mockResolvedValueOnce(response(state));
    const user = userEvent.setup();

    render(<PrimaryStagingConsole />);
    const approve = await screen.findByRole("button", { name: "Approve checked-in refund" });
    expect(screen.getByLabelText("Supervisor reason")).toBeInTheDocument();
    expect(screen.getByLabelText("Fraud review")).toBeInTheDocument();
    expect(screen.getByLabelText("Checked-in refund cost bearer")).toHaveValue("ORGANIZER");
    await user.click(approve);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[2]).toEqual(["/api/staging/primary/actions", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"action":"approveCheckedRefund"'),
    })]);
  });
});
