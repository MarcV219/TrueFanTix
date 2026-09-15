import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail, type EmailSendResult } from "@/lib/email";
import { emailProviderEvidence } from "@/lib/emailProviderConfig";

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

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function sendDisputeEmails(params: {
  orderId: string;
  kind: "OPENED" | "UPDATED" | "CANCELLED" | "RESOLVED" | "REFUNDED";
  parties: DisputeEmailParty[];
  submittedBy: string;
  comments: string;
  ticketCount: number;
  tickets?: string[];
  fileNames: string[];
  idempotencyKeyPrefix?: string;
}, db: Pick<Prisma.TransactionClient, "emailDelivery"> = prisma) {
  const buyerLink = `${appOrigin()}/account/tickets/holding`;
  const sellerLink = `${appOrigin()}/account/tickets/seller-holding`;
  const adminLink = `${appOrigin()}/admin/orders/${encodeURIComponent(params.orderId)}`;
  const subject =
    params.kind === "OPENED"
      ? `Dispute opened for TrueFanTix order ${params.orderId}`
      : params.kind === "CANCELLED"
        ? `Dispute resolved by buyer for TrueFanTix order ${params.orderId}`
        : params.kind === "REFUNDED"
          ? `Refund issued and dispute closed for TrueFanTix order ${params.orderId}`
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
            : params.kind === "REFUNDED"
              ? `DISPUTE_REFUNDED_${roleKey}`
            : params.kind === "RESOLVED"
              ? `DISPUTE_RESOLVED_${roleKey}`
            : params.idempotencyKeyPrefix
              ? `DISPUTE_UPDATE_${params.idempotencyKeyPrefix}_${roleKey}`
              : `DISPUTE_UPDATE_${Date.now()}_${roleKey}`;
      const link =
        party.role === "TrueFanTix Support"
          ? adminLink
          : party.role === "Seller"
            ? sellerLink
            : buyerLink;
      const text = `Hi ${party.firstName || party.role},

${params.kind === "OPENED" ? "A dispute has been opened." : params.kind === "CANCELLED" ? "The buyer cancelled the dispute and confirmed that it was satisfactorily resolved." : params.kind === "REFUNDED" ? "TrueFanTix Support issued the buyer a full refund and closed the dispute." : params.kind === "RESOLVED" ? "TrueFanTix Support resolved and closed the dispute." : "Additional information was added to an open dispute."}

${details}

${params.kind === "CANCELLED" || params.kind === "RESOLVED" || params.kind === "REFUNDED" ? "The case is now closed. View the order here:" : "Buyer and seller may add further comments and supporting documents from their TrueFanTix account while the case is open:"}
${link}

${params.kind === "REFUNDED" ? "The buyer’s full payment has been refunded. No seller payout will be issued for this order." : params.kind === "CANCELLED" || params.kind === "RESOLVED" ? "The order has returned to the normal completed-order payout process." : "Seller payout remains paused while this case is reviewed."}

TrueFanTix Support`;
      const html = `<p>Hi ${escapeHtml(party.firstName || party.role)},</p>
<p>${params.kind === "OPENED" ? "A dispute has been opened." : params.kind === "CANCELLED" ? "The buyer cancelled the dispute and confirmed that it was satisfactorily resolved." : params.kind === "REFUNDED" ? "TrueFanTix Support issued the buyer a full refund and closed the dispute." : params.kind === "RESOLVED" ? "TrueFanTix Support resolved and closed the dispute." : "Additional information was added to an open dispute."}</p>
<pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapeHtml(details)}</pre>
<p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#064a93;color:white;text-decoration:none;border-radius:8px;font-weight:bold">${params.kind === "CANCELLED" || params.kind === "RESOLVED" || params.kind === "REFUNDED" ? "View resolved case" : party.role === "TrueFanTix Support" ? "Review dispute case" : "View or add dispute information"}</a></p>
<p>${params.kind === "REFUNDED" ? "The buyer’s full payment has been refunded. No seller payout will be issued for this order." : params.kind === "CANCELLED" || params.kind === "RESOLVED" ? "The order has returned to the normal completed-order payout process." : "Seller payout remains paused while this case is reviewed."}</p>`;

      // Stable callers reserve the unique delivery identity before provider
      // I/O. Existing SENT, FAILED, or abandoned ATTEMPTING evidence is
      // terminal here: retry needs a durable attempt model, not a blind send.
      if (params.idempotencyKeyPrefix) {
        try {
          await db.emailDelivery.create({
            data: {
              orderId: params.orderId,
              emailType,
              recipient: party.email,
              provider: "CONSOLE",
              status: "ATTEMPTING",
              error: null,
            },
          });
        } catch (error) {
          if (isUniqueConstraintError(error)) return;
          throw error;
        }
      }

      let result: EmailSendResult;
      try {
        result = await sendEmail({
          to: party.email,
          subject,
          text,
          html,
          idempotencyKey: params.idempotencyKeyPrefix
            ? `${params.idempotencyKeyPrefix}:${roleKey}`
            : undefined,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown email error";
        result = {
          ok: false,
          provider: "CONSOLE",
          providerResult: "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE",
          error: `EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: ${errorMessage}`,
        };
      }
      if (params.idempotencyKeyPrefix) {
        const completed = await db.emailDelivery.updateMany({
          where: {
            orderId: params.orderId,
            emailType,
            recipient: party.email,
            status: "ATTEMPTING",
          },
          data: {
            sentAt: new Date(),
            provider: emailProviderEvidence(result),
            status: result.ok ? "SENT" : "FAILED",
            error: result.error || null,
          },
        });
        if (completed.count !== 1) {
          console.error(
            `Could not finalize owned dispute email delivery for ${party.email}: delivery evidence changed`,
          );
        }
        return;
      }

      await db.emailDelivery.upsert({
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
          provider: emailProviderEvidence(result),
          status: result.ok ? "SENT" : "FAILED",
          error: result.error || null,
        },
        update: {
          sentAt: new Date(),
          provider: emailProviderEvidence(result),
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
