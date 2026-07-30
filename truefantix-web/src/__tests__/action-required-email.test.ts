import {
  generateBuyerTransferConfirmationRequiredEmail,
  generateSaleNotificationEmail,
  generateSellerTransferReminderEmail,
} from "@/lib/email";

describe("action-required email prominence", () => {
  const deadline = new Date("2099-07-31T16:00:00.000Z");

  it("makes the initial seller transfer action prominent", () => {
    const email = generateSaleNotificationEmail("order-1", "Pam", "Finals Game", "50.00");

    expect(email.subject).toMatch(/^ACTION REQUIRED:/);
    expect(email.text).toContain("ACTION REQUIRED");
    expect(email.text).toContain("transfer it to the buyer, upload proof, and confirm the transfer within 24 hours");
    expect(email.html).toContain("ACTION REQUIRED");
    expect(email.html).toContain("Transfer required within 24 hours");
    expect(email.html).toContain("Transfer Tickets Now");
  });

  it("makes seller reminders clearly action-required", () => {
    const email = generateSellerTransferReminderEmail("order-1", "Pam", 2, deadline);

    expect(email.subject).toMatch(/^ACTION REQUIRED:/);
    expect(email.text).toMatch(/^ACTION REQUIRED/);
    expect(email.html).toContain("ACTION REQUIRED");
    expect(email.html).toContain("Your transfer is still waiting");
    expect(email.html).toContain("Transfer Tickets Now");
  });

  it("makes buyer confirmation requests clearly action-required", () => {
    const email = generateBuyerTransferConfirmationRequiredEmail("order-1", "Alex", 2, deadline);

    expect(email.subject).toMatch(/^ACTION REQUIRED:/);
    expect(email.text).toMatch(/^ACTION REQUIRED/);
    expect(email.html).toContain("ACTION REQUIRED");
    expect(email.html).toContain("You need to respond by");
    expect(email.html).toContain("Confirm or Dispute Transfer");
  });
});
