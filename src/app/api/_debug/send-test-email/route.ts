import { NextResponse } from "next/server";
import { resend, DEFAULT_FROM } from "@/lib/email/resend";

export async function GET() {
  try {
    const result = await resend.emails.send({
      from: DEFAULT_FROM,
      to: ["villeneuvemarc945@gmail.com"],
      subject: "TrueFanTix email system is live ✅",
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2>It works.</h2>
          <p>This is a test email from Resend using <b>mail.truefantix.com</b>.</p>
        </div>
      `,
    });

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
