import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

export const DISPUTE_SUPPORT_EMAIL = "support@truefantix.com";

type DisputeEmailParty = {
  email: string;
  firstName?: string | null;
  role: "Buyer" | "Seller" | "TrueFanTix Support";
};

function appOrigin() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_ORIGIN || "https://truefantix-web.vercel.app").replace(/\/$/, "");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character
  ));
}

export async function sendDisputeEmails(params: {
  orderId: string;
  kind: "OPENED" | "UPDATED" | "CANCELLED" | "RESOLVED";
  parties: DisputeEmailParty[];
  submittedBy: string;
  comments: string;
  ticketCount: number;
  tickets?: string[];
  fileNames: string[];
}) {
  const buyerLink = `${appOrigin()}/account/tickets/holding`;
  const sellerLink = `${appOrigin()}/account/tickets/seller-holding`;
  const adminLink = `${appOrigin()}/admin/orders/${encodeURIComponent(params.orderId)}`;
  const subject =
    params.kind === "OPENED"
      ? `Dispute opened for TrueFanTix order ${params.orderId}`
      : params.kind === "CANCELLED"
        ? `Dispute resolved by buyer for TrueFanTix order ${params.orderId}`
        : params.kind === "RESOLVED"
          ? `Dispute closed for TrueFanTix order ${params.orderId}`
        : `New dispute information for TrueFanTix order ${params.orderId}`;
  const details = [
    `Order: ${params.orderId}`,
    `Submitted by: ${params.submittedBy}`,
    `Tickets disputed: ${params.ticketCount}`,
    ...(params.tickets?.length ? [`Ticket details:\n- ${params.tickets.join("\n- ")}`] : []),
    `Comments: ${params.comments}`,
    `Documents: ${params.fileNames.length ? params.fileNames.join(", ") : "None"}`,
  ].join("\n");

  const deliveries = await Promise.allSettled(
    params.parties.map(async (party) => {
      const roleKey = party.role.toUpperCase().replaceAll(" ", "_");
      const emailType =
        params.kind === "OPENED"
          ? `DISPUTE_OPENED_${roleKey}`
          : params.kind === "CANCELLED"
            ? `DISPUTE_CANCELLED_${roleKey}`
            : params.kind === "RESOLVED"
              ? `DISPUTE_RESOLVED_${roleKey}`
            : `DISPUTE_UPDATE_${Date.now()}_${roleKey}`;
      const link =
        party.role === "TrueFanTix Support"
          ? adminLink
          : party.role === "Seller"
            ? sellerLink
            : buyerLink;
      const text = `Hi ${party.firstName || party.role},

${params.kind === "OPENED" ? "A dispute has been opened." : params.kind === "CANCELLED" ? "The buyer cancelled the dispute and confirmed that it was satisfactorily resolved." : params.kind === "RESOLVED" ? "TrueFanTix Support resolved and closed the dispute." : "Additional information was added to an open dispute."}

${details}

${params.kind === "CANCELLED" || params.kind === "RESOLVED" ? "The case is now closed. View the order here:" : "Buyer and seller may add further comments and supporting documents from their TrueFanTix account while the case is open:"}
${link}

${params.kind === "CANCELLED" || params.kind === "RESOLVED" ? "The order has returned to the normal completed-order payout process." : "Seller payout remains paused while this case is reviewed."}

TrueFanTix Support`;
      const html = `<p>Hi ${escapeHtml(party.firstName || party.role)},</p>
<p>${params.kind === "OPENED" ? "A dispute has been opened." : params.kind === "CANCELLED" ? "The buyer cancelled the dispute and confirmed that it was satisfactorily resolved." : params.kind === "RESOLVED" ? "TrueFanTix Support resolved and closed the dispute." : "Additional information was added to an open dispute."}</p>
<pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapeHtml(details)}</pre>
<p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#064a93;color:white;text-decoration:none;border-radius:8px;font-weight:bold">${params.kind === "CANCELLED" || params.kind === "RESOLVED" ? "View resolved case" : party.role === "TrueFanTix Support" ? "Review dispute case" : "View or add dispute information"}</a></p>
<p>${params.kind === "CANCELLED" || params.kind === "RESOLVED" ? "The order has returned to the normal completed-order payout process." : "Seller payout remains paused while this case is reviewed."}</p>`;
      const result = await sendEmail({ to: party.email, subject, text, html });
      await prisma.emailDelivery.upsert({
        where: {
          orderId_emailType_recipient: {
            orderId: params.orderId,
            emailType,
            recipient: party.email,
          },
        },
        create: {
          orderId: params.orderId,
          emailType,
          recipient: party.email,
          provider: process.env.RESEND_API_KEY ? "RESEND" : process.env.SENDGRID_API_KEY ? "SENDGRID" : "CONSOLE",
          status: result.ok ? "SENT" : "FAILED",
          error: result.error || null,
        },
        update: {
          sentAt: new Date(),
          status: result.ok ? "SENT" : "FAILED",
          error: result.error || null,
        },
      });
    })
  );
  deliveries.forEach((delivery, index) => {
    if (delivery.status === "rejected") {
      console.error(`Could not record dispute email delivery for ${params.parties[index]?.email}:`, delivery.reason);
    }
  });
}

export { parseDisputeCase } from "@/lib/dispute-case";
export type { DisputeCase } from "@/lib/dispute-case";
