import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  contactMergeVars,
  isGenericOutreachEmail,
  renderMerge,
} from "../src/lib/outreach";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool), log: ["error"] });

async function main() {
  const affected = await prisma.outreachContact.findMany({
    where: { contactName: { not: null }, email: { not: null } },
    select: { id: true, email: true },
  });
  const contactIds = affected
    .filter((contact) => isGenericOutreachEmail(contact.email))
    .map((contact) => contact.id);

  const result = await prisma.$transaction(async (tx) => {
    const contacts = contactIds.length
      ? await tx.outreachContact.updateMany({
          where: { id: { in: contactIds } },
          data: { contactName: null },
        })
      : { count: 0 };

    const recipients = await tx.outreachRecipient.findMany({
      where: {
        status: "PENDING",
        campaign: { status: "DRAFT" },
        contactId: { in: contactIds },
      },
      select: {
        id: true,
        campaign: { select: { subject: true, bodyText: true, bodyHtml: true } },
        contact: {
          select: {
            contactName: true,
            subjectName: true,
            organization: true,
            role: true,
            email: true,
          },
        },
      },
    });

    for (const recipient of recipients) {
      const vars = contactMergeVars(recipient.contact);
      await tx.outreachRecipient.update({
        where: { id: recipient.id },
        data: {
          subjectSnapshot: renderMerge(recipient.campaign.subject, vars),
          bodyTextSnapshot: renderMerge(recipient.campaign.bodyText, vars),
          bodyHtmlSnapshot: recipient.campaign.bodyHtml
            ? renderMerge(recipient.campaign.bodyHtml, vars)
            : null,
        },
      });
    }

    return { contacts: contacts.count, draftRecipients: recipients.length };
  });

  console.log(JSON.stringify({ ok: true, ...result }));
}

main().finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
