import sgMail from "@sendgrid/mail";

export const DEFAULT_FROM_EMAIL = "noreply@truefantix.com";

export type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

function cleanSecret(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, "");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character
  ));
}

function resendErrorMessage(status: number, body: string) {
  if (status === 401 || /api key is invalid/i.test(body)) {
    return "Email provider rejected the Resend API key. Update RESEND_API_KEY in Vercel.";
  }
  if (/domain|from/i.test(body)) {
    return "Email provider rejected the sender address. Verify FROM_EMAIL or the sending domain in Resend.";
  }
  return `Resend ${status}`;
}

export async function sendEmail(payload: EmailPayload): Promise<{ ok: boolean; error?: string }> {
  const sendgridApiKey = cleanSecret(process.env.SENDGRID_API_KEY);
  const resendApiKey = cleanSecret(process.env.RESEND_API_KEY);
  const configuredFromEmail = process.env.FROM_EMAIL?.trim();
  const fromEmail = configuredFromEmail || DEFAULT_FROM_EMAIL;

  // Prefer Resend when configured (Path B), fallback to SendGrid.
  if (resendApiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [payload.to],
          subject: payload.subject,
          text: payload.text,
          html: payload.html,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error("[EMAIL] Resend error:", res.status, body);
        return { ok: false, error: resendErrorMessage(res.status, body) };
      }

      return { ok: true };
    } catch (err: any) {
      console.error("[EMAIL] Resend network error:", err);
      return { ok: false, error: err?.message || "Resend request failed" };
    }
  }

  if (sendgridApiKey) {
    sgMail.setApiKey(sendgridApiKey);

    try {
      await sgMail.send({
        to: payload.to,
        from: fromEmail,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      });
      return { ok: true };
    } catch (err: any) {
      console.error("[EMAIL] SendGrid error:", err);
      return { ok: false, error: err.message };
    }
  }

  if (process.env.NODE_ENV === "production") {
    console.error("[EMAIL] No provider configured (RESEND_API_KEY/SENDGRID_API_KEY).");
    return { ok: false, error: "Email provider is not configured" };
  }

  console.log("[EMAIL] No provider configured (RESEND_API_KEY/SENDGRID_API_KEY). Logging to console instead");
  console.log("[EMAIL] To:", payload.to);
  console.log("[EMAIL] Subject:", payload.subject);
  console.log("[EMAIL] Text:", payload.text.slice(0, 200) + "...");
  return { ok: true }; // DEV mode - pretend it worked
}

export function generateVerificationEmail(code: string, firstName: string | null) {
  const subject = "Your TrueFanTix Verification Code";
  const text = `Hi ${firstName || "there"},

Your verification code is: ${code}

This code will expire in 10 minutes.

If you didn't request this code, please ignore this email.

Thanks,
The TrueFanTix Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #064a93; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .code { font-size: 32px; font-weight: bold; color: #064a93; letter-spacing: 8px; text-align: center; padding: 20px; background: white; border-radius: 8px; margin: 20px 0; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>TrueFanTix</h1>
    </div>
    <div class="content">
      <p>Hi ${firstName || "there"},</p>
      <p>Your verification code is:</p>
      <div class="code">${code}</div>
      <p>This code will expire in <strong>10 minutes</strong>.</p>
      <p>If you didn't request this code, please ignore this email.</p>
      <p>Thanks,<br>The TrueFanTix Team</p>
    </div>
    <div class="footer">
      <p>This is an automated message from TrueFanTix. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

export function generatePasswordResetEmail(resetUrl: string, firstName: string | null) {
  const subject = "Reset Your TrueFanTix Password";
  const text = `Hi ${firstName || "there"},

We received a request to reset your password. Click the link below to create a new password:

${resetUrl}

This link will expire in 1 hour.

If you didn't request this reset, please ignore this email.

Thanks,
The TrueFanTix Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #064a93; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; background: #064a93; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
    .link { word-break: break-all; color: #064a93; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>TrueFanTix</h1>
    </div>
    <div class="content">
      <p>Hi ${firstName || "there"},</p>
      <p>We received a request to reset your password. Click the button below to create a new password:</p>
      <div style="text-align: center;">
        <a href="${resetUrl}" class="button">Reset Password</a>
      </div>
      <p>Or copy and paste this link into your browser:</p>
      <p class="link">${resetUrl}</p>
      <p>This link will expire in <strong>1 hour</strong>.</p>
      <p>If you didn't request this reset, please ignore this email.</p>
      <p>Thanks,<br>The TrueFanTix Team</p>
    </div>
    <div class="footer">
      <p>This is an automated message from TrueFanTix. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

export function generatePurchaseConfirmationEmail(
  orderId: string,
  firstName: string | null,
  tickets: { title: string; venue: string; date: string }[],
  total: string
) {
  const subject = "Your TrueFanTix Purchase Confirmation";
  
  const ticketList = tickets.map(t => `- ${t.title} at ${t.venue} (${t.date})`).join("\n");
  const ticketListHtml = tickets.map(t => 
    `<li style="margin-bottom: 8px;"><strong>${t.title}</strong><br><span style="color: #6b7280;">${t.venue} • ${t.date}</span></li>`
  ).join("");

  const text = `Hi ${firstName || "there"},

Thank you for your purchase! Your order has been confirmed.

Order ID: ${orderId}
Total: $${total}

Tickets:
${ticketList}

What happens next:
1. Your payment is being held by TrueFanTix while the seller transfers the tickets.
2. The seller has 24 hours to transfer the tickets to you and confirm the transfer.
3. After the seller confirms transfer, you will be notified right away and will have 24 hours to confirm that you received the tickets.
4. If you do not confirm or open a dispute within that 24-hour confirmation period, the seller payout will be released automatically.

You can track these tickets in Account > Holding.

Thanks,
The TrueFanTix Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #064a93; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .order-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .button { display: inline-block; background: #064a93; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
    .process { background: #eff6ff; border: 1px solid #bfdbfe; padding: 18px; border-radius: 8px; margin: 20px 0; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
    .total { font-size: 24px; font-weight: bold; color: #064a93; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>TrueFanTix</h1>
    </div>
    <div class="content">
      <p>Hi ${firstName || "there"},</p>
      <p>Thank you for your purchase! Your order has been confirmed.</p>
      
      <div class="order-info">
        <p><strong>Order ID:</strong> ${orderId}</p>
        <p class="total">Total: $${total}</p>
        
        <h3 style="margin-top: 20px;">Your Tickets:</h3>
        <ul style="padding-left: 20px;">
          ${ticketListHtml}
        </ul>
      </div>

      <div class="process">
        <h3 style="margin-top: 0;">What happens next</h3>
        <ol style="padding-left: 20px; margin-bottom: 0;">
          <li>Your payment is held by TrueFanTix while the seller transfers the tickets.</li>
          <li>The seller has <strong>24 hours</strong> to transfer the tickets and confirm the transfer.</li>
          <li>After that, you will be notified right away and will have <strong>24 hours</strong> to confirm you received the tickets.</li>
          <li>If you do not confirm or open a dispute within that 24-hour period, the seller payout will be released automatically.</li>
        </ol>
      </div>
      
      <div style="text-align: center;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/account/tickets/holding" class="button">View Holding Tickets</a>
      </div>
      
      <p>Thanks,<br>The TrueFanTix Team</p>
    </div>
    <div class="footer">
      <p>This is an automated message from TrueFanTix. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

export function generateBuyerTransferConfirmationRequiredEmail(
  orderId: string,
  firstName: string | null,
  ticketCount: number,
  deadline: Date
) {
  const ticketWord = ticketCount === 1 ? "ticket" : "tickets";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_ORIGIN || "https://truefantix.com";
  const holdingUrl = `${appUrl.replace(/\/$/, "")}/account/tickets/holding`;
  const deadlineText = new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(deadline);
  const subject = "ACTION REQUIRED: Confirm or Dispute Your Ticket Transfer";

  const text = `ACTION REQUIRED

Hi ${firstName || "there"},

The seller has confirmed that ${ticketCount} ${ticketWord} for order ${orderId} ${ticketCount === 1 ? "has" : "have"} been transferred to you.

Please sign in to TrueFanTix and confirm receipt by ${deadlineText}. If anything looks incorrect or you have not received the transfer, open a dispute before the deadline.

If you do not confirm receipt or open a dispute within the 24-hour confirmation window, the payment hold will be released to the seller automatically.

Confirm or dispute the transfer:
${holdingUrl}

Thanks,
The TrueFanTix Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #064a93; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .notice { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #064a93; }
    .deadline { background: #fffbeb; border: 1px solid #fcd34d; padding: 16px; border-radius: 8px; margin: 20px 0; }
    .button { display: inline-block; background: #064a93; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <p style="margin: 0 0 6px; font-size: 14px; font-weight: bold; letter-spacing: 1.5px;">ACTION REQUIRED</p>
      <h1 style="margin: 0;">Confirm Your Ticket Transfer</h1>
    </div>
    <div class="content">
      <p>Hi ${firstName || "there"},</p>
      <div style="background: #fff7ed; border: 2px solid #f97316; color: #9a3412; padding: 18px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0; font-size: 18px; font-weight: bold;">You need to respond by ${deadlineText}</p>
        <p style="margin: 6px 0 0;">Confirm that you received the tickets, or open a dispute if you did not.</p>
      </div>
      <div class="notice">
        <p>The seller has confirmed that <strong>${ticketCount} ${ticketWord}</strong> for order <strong>${orderId}</strong> ${ticketCount === 1 ? "has" : "have"} been transferred to you.</p>
      </div>
      <p>Please sign in to TrueFanTix and confirm receipt. If anything looks incorrect or you have not received the transfer, open a dispute before the deadline.</p>
      <div class="deadline">
        <p style="margin-top: 0;"><strong>Confirmation deadline:</strong> ${deadlineText}</p>
        <p style="margin-bottom: 0;">If you do not confirm receipt or open a dispute within the 24-hour confirmation window, the payment hold will be released to the seller automatically.</p>
      </div>
      <div style="text-align: center;">
        <a href="${holdingUrl}" class="button">Confirm or Dispute Transfer</a>
      </div>
      <p>Thanks,<br>The TrueFanTix Team</p>
    </div>
    <div class="footer">
      <p>This is an automated message from TrueFanTix. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

export function generateDisputeInformationRequestEmail({
  orderId,
  firstName,
  requestMessage,
  responseUrl,
}: {
  orderId: string;
  firstName: string | null;
  requestMessage: string;
  responseUrl: string;
}) {
  const subject = `ACTION REQUIRED: More Information Needed for Dispute ${orderId}`;
  const text = `ACTION REQUIRED

Hi ${firstName || "there"},

TrueFanTix Support needs more information from you for dispute ${orderId}.

Request from Support:
${requestMessage}

Submit your comments and supporting documents:
${responseUrl}

Seller payout remains paused while this dispute is reviewed.

TrueFanTix Support`;
  const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #c2410c; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; padding: 14px 24px; background: #064a93; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <p style="margin: 0 0 6px; font-size: 14px; font-weight: bold; letter-spacing: 1.5px;">ACTION REQUIRED</p>
      <h1 style="margin: 0;">Support Needs More Information</h1>
    </div>
    <div class="content">
      <p>Hi ${escapeHtml(firstName || "there")},</p>
      <div style="background: #fff7ed; border: 2px solid #f97316; color: #9a3412; padding: 18px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0; font-size: 18px; font-weight: bold;">Your response is required</p>
        <p style="margin: 6px 0 0;">TrueFanTix Support needs additional information or documents for dispute <strong>${escapeHtml(orderId)}</strong>.</p>
      </div>
      <p><strong>Request from Support:</strong></p>
      <div style="white-space: pre-wrap; padding: 14px; background: white; border-left: 4px solid #064a93; border-radius: 8px; margin: 16px 0;">${escapeHtml(requestMessage)}</div>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${escapeHtml(responseUrl)}" class="button">Respond and Upload Documents</a>
      </div>
      <p>Seller payout remains paused while this dispute is reviewed.</p>
      <p>TrueFanTix Support</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

export function generateSaleNotificationEmail(
  orderId: string,
  firstName: string | null,
  ticketTitle: string,
  amount: string
) {
  const subject = "ACTION REQUIRED: Ticket Sold — Transfer It Within 24 Hours";
  
  const text = `ACTION REQUIRED

Hi ${firstName || "there"},

Your ticket sold. You must transfer it to the buyer, upload proof, and confirm the transfer within 24 hours.

Order ID: ${orderId}
Ticket: ${ticketTitle}
Sale Amount: $${amount}

What happens next:
1. The buyer's payment is being held by TrueFanTix.
2. You have 24 hours to transfer the ticket to the buyer and confirm the transfer in your seller holding page.
3. After you confirm transfer, the buyer will be notified right away and will have 24 hours to confirm receipt.
4. If the buyer confirms receipt, seller payout becomes eligible. If the buyer does not confirm or open a dispute within 24 hours, seller payout is released automatically.

You will receive reminders right away and every 6 hours until you confirm transfer.

Thanks,
The TrueFanTix Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #c2410c; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .sale-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .process { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 18px; border-radius: 8px; margin: 20px 0; }
    .button { display: inline-block; background: #16a34a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
    .amount { font-size: 28px; font-weight: bold; color: #22c55e; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <p style="margin: 0 0 6px; font-size: 14px; font-weight: bold; letter-spacing: 1.5px;">ACTION REQUIRED</p>
      <h1 style="margin: 0;">Transfer Your Sold Ticket</h1>
    </div>
    <div class="content">
      <p>Hi ${firstName || "there"},</p>
      <p>Great news! Your ticket has been sold on TrueFanTix.</p>

      <div style="background: #fff7ed; border: 2px solid #f97316; color: #9a3412; padding: 18px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0; font-size: 20px; font-weight: bold;">Transfer required within 24 hours</p>
        <p style="margin: 6px 0 0;">Transfer the ticket to the buyer, upload proof, and confirm the transfer in Seller Holding.</p>
      </div>
      
      <div class="sale-info">
        <p><strong>Order ID:</strong> ${orderId}</p>
        <p><strong>Ticket:</strong> ${ticketTitle}</p>
        <p style="margin-top: 16px;">Sale Amount:</p>
        <p class="amount">$${amount}</p>
      </div>
      
      <div class="process">
        <h3 style="margin-top: 0;">What happens next</h3>
        <ol style="padding-left: 20px; margin-bottom: 0;">
          <li>The buyer's payment is held by TrueFanTix.</li>
          <li>You have <strong>24 hours</strong> to transfer the ticket to the buyer and confirm the transfer.</li>
          <li>After you confirm transfer, the buyer is notified right away and has <strong>24 hours</strong> to confirm receipt.</li>
          <li>If the buyer confirms receipt, seller payout becomes eligible. If the buyer does not confirm or open a dispute within 24 hours, seller payout is released automatically.</li>
        </ol>
        <p style="margin-bottom: 0;">You will receive reminders right away and every 6 hours until you confirm transfer.</p>
      </div>

      <div style="text-align: center;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/account/tickets/seller-holding" class="button">Transfer Tickets Now</a>
      </div>
      
      <p>Thanks,<br>The TrueFanTix Team</p>
    </div>
    <div class="footer">
      <p>This is an automated message from TrueFanTix. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

export function generateSellerTransferReminderEmail(
  orderId: string,
  firstName: string | null,
  ticketCount: number,
  deadline: Date
) {
  const overdue = deadline.getTime() <= Date.now();
  const ticketWord = ticketCount === 1 ? "ticket" : "tickets";
  const deadlineText = new Intl.DateTimeFormat("en-CA", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(deadline);
  const holdingUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://truefantix-web.vercel.app"}/account/tickets/seller-holding`;
  const subject = overdue
    ? "ACTION OVERDUE: Transfer and Confirm Your Sold Tickets"
    : "ACTION REQUIRED: Transfer and Confirm Your Sold Tickets";

  const text = `${overdue ? "ACTION OVERDUE" : "ACTION REQUIRED"}

Hi ${firstName || "there"},

${overdue ? "Your 24-hour transfer deadline has passed." : "Your sold tickets are still awaiting transfer confirmation."}

Order ID: ${orderId}
Tickets: ${ticketCount} ${ticketWord}
Transfer deadline: ${deadlineText}

Transfer the tickets through the original ticket provider, then upload your transfer proof and confirm the transfer in Seller Holding:

${holdingUrl}

The buyer's payment remains protected while the transfer is incomplete. You will continue receiving reminders every 6 hours until you confirm the transfer.

Thanks,
The TrueFanTix Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${overdue ? "#b91c1c" : "#064a93"}; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .details { background: white; padding: 18px; border-radius: 8px; margin: 20px 0; }
    .button { display: inline-block; background: #064a93; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <p style="margin: 0 0 6px; font-size: 14px; font-weight: bold; letter-spacing: 1.5px;">${overdue ? "ACTION OVERDUE" : "ACTION REQUIRED"}</p>
      <h1 style="margin: 0;">Transfer Your Sold Tickets</h1>
    </div>
    <div class="content">
      <p>Hi ${firstName || "there"},</p>
      <div style="background: ${overdue ? "#fef2f2" : "#fff7ed"}; border: 2px solid ${overdue ? "#dc2626" : "#f97316"}; color: ${overdue ? "#991b1b" : "#9a3412"}; padding: 18px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0; font-size: 18px; font-weight: bold;">${overdue ? "Your 24-hour deadline has passed" : "Your transfer is still waiting"}</p>
        <p style="margin: 6px 0 0;">Transfer the tickets, upload proof, and confirm the transfer now.</p>
      </div>
      <div class="details">
        <p><strong>Order ID:</strong> ${orderId}</p>
        <p><strong>Tickets:</strong> ${ticketCount} ${ticketWord}</p>
        <p><strong>Transfer deadline:</strong> ${deadlineText}</p>
      </div>
      <p>Transfer the tickets through the original ticket provider, then upload your transfer proof and confirm the transfer in Seller Holding.</p>
      <div style="text-align: center;"><a href="${holdingUrl}" class="button">Transfer Tickets Now</a></div>
      <p>The buyer's payment remains protected while the transfer is incomplete. You will continue receiving reminders every 6 hours until you confirm the transfer.</p>
      <p>Thanks,<br>The TrueFanTix Team</p>
    </div>
    <div class="footer"><p>This is an automated message from TrueFanTix. Please do not reply to this email.</p></div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}
