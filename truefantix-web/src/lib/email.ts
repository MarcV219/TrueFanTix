import sgMail from "@sendgrid/mail";

export type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export async function sendEmail(payload: EmailPayload): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || "noreply@truefantix.com";

  if (!apiKey) {
    console.log("[EMAIL] SENDGRID_API_KEY not set - logging to console instead");
    console.log("[EMAIL] To:", payload.to);
    console.log("[EMAIL] Subject:", payload.subject);
    console.log("[EMAIL] Text:", payload.text.slice(0, 200) + "...");
    return { ok: true }; // DEV mode - pretend it worked
  }

  sgMail.setApiKey(apiKey);

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

You can view your tickets in your account at any time.

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
      
      <div style="text-align: center;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/account/orders" class="button">View My Tickets</a>
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

export function generateSaleNotificationEmail(
  orderId: string,
  firstName: string | null,
  ticketTitle: string,
  amount: string
) {
  const subject = "Your Ticket Sold on TrueFanTix!";
  
  const text = `Hi ${firstName || "there"},

Great news! Your ticket has been sold.

Order ID: ${orderId}
Ticket: ${ticketTitle}
Sale Amount: $${amount}

The payment is being processed and will be transferred to your account soon.

Thanks,
The TrueFanTix Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #22c55e; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .sale-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .amount { font-size: 28px; font-weight: bold; color: #22c55e; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 Ticket Sold!</h1>
    </div>
    <div class="content">
      <p>Hi ${firstName || "there"},</p>
      <p>Great news! Your ticket has been sold on TrueFanTix.</p>
      
      <div class="sale-info">
        <p><strong>Order ID:</strong> ${orderId}</p>
        <p><strong>Ticket:</strong> ${ticketTitle}</p>
        <p style="margin-top: 16px;">Sale Amount:</p>
        <p class="amount">$${amount}</p>
      </div>
      
      <p>The payment is being processed and will be transferred to your account soon.</p>
      
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
