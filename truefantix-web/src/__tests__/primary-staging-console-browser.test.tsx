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
      refunds: [{ id: "refund-1", status: "REQUESTED", reason: "Synthetic", requestedAmountMinor: 3120, currency: "CAD", checkedInApprovals: [] }],
      orders: [{ id: "checked-order", grossTotalMinor: 3120, currency: "CAD", admissionTickets: [{ id: "checked-ticket", unitNumber: 1, status: "CHECKED_IN", voidReason: null, revocations: [], refundItems: [] }] }],
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
    expect(screen.getByText("refund REQUESTED · revocations 0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request checked-in refund" })).not.toBeInTheDocument();
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

  it("renders durable approval, provider, waiver, and revocation evidence", async () => {
    const evidenceDigest = "a".repeat(64);
    const waiverDigest = "b".repeat(64);
    const state = { ok: true, actor: admin, organizers: [], audit: [], refundConsole: { generation: 2, organizerId: "refund-organizer", events: [{
      id: "staging-refund-g2-cancellation-event", title: "Synthetic Refund Console / Event cancellation and obligations", status: "APPROVED",
      refunds: [{ id: "refund-1", status: "SUCCEEDED", reason: "Synthetic", requestedAmountMinor: 2100, currency: "CAD", checkedInApprovals: [] }],
      orders: [{ id: "cancellation-order", grossTotalMinor: 4200, currency: "CAD", admissionTickets: [{ id: "ticket-1", unitNumber: 1, status: "VOIDED", voidReason: "Synthetic cancellation", purchaseAllocations: [{ amountMinor: 2000, currency: "CAD", refundable: true, liabilityOwner: "ORGANIZER", remainderRank: 1, algorithmVersion: 1, allocationSetDigest: "d".repeat(64), component: { code: "FACE_VALUE", label: "Face value", kind: "FACE_VALUE" } }, { amountMinor: 100, currency: "CAD", refundable: true, liabilityOwner: "ORGANIZER", remainderRank: 1, algorithmVersion: 1, allocationSetDigest: "d".repeat(64), component: { code: "ORGANIZER_FEE", label: "Synthetic organizer fee", kind: "MANDATORY_FEE" } }], revocations: [{ cause: "EVENT_CANCELLATION", reason: "Synthetic cancellation evidence", refundId: "refund-1", cancellationId: "cancellation-1" }], refundItems: [{ refundId: "refund-1", requestedMinor: 2100, refund: { status: "SUCCEEDED", reason: "Synthetic", attempts: [{ ordinal: 1, status: "SUCCEEDED", expectedAmountMinor: 2100, currency: "CAD", providerRefundId: "synthetic-refund-1", authorizationReason: "Authorized isolated synthetic completion", providerEvents: [{ providerEventId: "synthetic-success-event-1", eventType: "synthetic.refund.succeeded", payloadDigest: "c".repeat(64), providerCreatedAt: "2026-09-12T01:31:00.000Z" }] }], checkedInApprovals: [{ reason: "Scoped supervisor approval", fraudReview: "No indicators", costBearer: "ORGANIZER", evidenceDigest, approver: { email: admin.email } }] } }] }] }],
      cancellations: [{ id: "cancellation-1", status: "RESOLVED", activatedAt: "2026-09-12T01:30:00.000Z", expectedTicketCount: 2, expectedAmountMinor: 4200, processedTicketCount: 2, processedAmountMinor: 4200, snapshotTickets: [{ admissionTicketId: "ticket-1", amountMinor: 2100, currency: "CAD" }], refundLinks: [{ refundId: "refund-1" }], batches: [{ processedTicketCount: 2, processedAmountMinor: 4200, firstTicketId: "ticket-1", lastTicketId: "ticket-2" }], obligations: [{ id: "obligation-1", status: "WAIVED_WITH_APPROVAL", cause: "CHECKED_IN_CANCELLATION_WAIVER", amountMinor: 2100, currency: "CAD", refundId: null, cancellationClaims: [{ admissionTicketId: "ticket-1", amountMinor: 2100, refundItemId: null }], waiverApproval: { reason: "Attendee attended event", evidenceDigest: waiverDigest, approver: { email: admin.email } } }] }],
    }], audit: [{ id: "audit-1", organizerId: "refund-organizer", eventId: "staging-refund-g2-cancellation-event", actorUserId: admin.id, actor: { email: admin.email }, action: "STAGING_REFUND_ACTION_REJECTED", targetType: "StagingRefundCommand", targetId: "completeCancellation", reason: "CANCELLATION_WAIVER_REQUIRED", afterJson: { status: "REJECTED", code: "CANCELLATION_WAIVER_REQUIRED", scenario: "cancellation", generation: 2 }, createdAt: "2026-09-12T01:32:00.000Z" }] } };
    jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(response({ ok: true, actor: admin }))
      .mockResolvedValueOnce(response(state));

    render(<PrimaryStagingConsole />);

    const scenario = (await screen.findByRole("heading", { name: "Event cancellation and obligations" })).closest("article");
    expect(scenario).toHaveTextContent(`Supervisor: ${admin.email} · ORGANIZER`);
    expect(scenario).toHaveTextContent("Immutable purchase allocation:");
    expect(scenario).toHaveTextContent("Face value (FACE_VALUE) · $20.00 · refundable · ORGANIZER");
    expect(scenario).toHaveTextContent("Synthetic organizer fee (ORGANIZER_FEE) · $1.00 · refundable · ORGANIZER");
    expect(scenario).toHaveTextContent(`v1 · digest ${"d".repeat(64)}`);
    expect(scenario).toHaveTextContent("Fraud review: No indicators");
    expect(scenario).toHaveTextContent("Synthetic provider evidence: attempt 1 · SUCCEEDED · $21.00");
    expect(scenario).toHaveTextContent("Completion event: synthetic.refund.succeeded · synthetic-success-event-1");
    expect(scenario).toHaveTextContent("Revocation: EVENT_CANCELLATION");
    expect(scenario).toHaveTextContent("Admission gate: blocked from cancellation activation");
    expect(scenario).toHaveTextContent("Snapshot: ticket-1 · $21.00");
    expect(scenario).toHaveTextContent("Disposition: ticket-1 · $21.00 · waiver");
    expect(scenario).toHaveTextContent("Cancellation refund link: refund-1");
    expect(scenario).toHaveTextContent("Batch: ticket-1 through ticket-2 · 2 ticket(s) · $42.00");
    expect(scenario).toHaveTextContent("Waiver: admin@primary-staging.example.invalid · Attendee attended event");
    expect(scenario).toHaveTextContent(evidenceDigest);
    expect(scenario).toHaveTextContent(waiverDigest);
    expect(screen.getAllByRole("columnheader", { name: "Actor" })).not.toHaveLength(0);
    expect(screen.getAllByText("CANCELLATION_WAIVER_REQUIRED")).not.toHaveLength(0);
    expect(screen.getByText(/\"generation\":2/)).toBeInTheDocument();
  });
});
