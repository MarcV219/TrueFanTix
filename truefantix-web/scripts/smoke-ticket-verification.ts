import { TicketStatus, TicketVerificationStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { autoVerifyTicketById } from '../src/lib/tickets/verification';
import { prisma } from '../src/lib/prisma';

function hash(v:string){ return createHash('sha256').update(v).digest('hex'); }

async function main(){
  const tag = `smoke-${Date.now()}`;

  const seller = await prisma.seller.create({
    data: { name: `Smoke Seller ${tag}`, creditBalanceCredits: 0 },
  });

  const event = await prisma.event.create({
    data: { title: `Smoke Event ${tag}`, venue: 'Test Venue', date: '2026-12-31 8:00 PM' },
  });

  const barcodeHash = hash(`BARCODE-${tag}`);

  const t1 = await prisma.ticket.create({
    data: {
      title: 'Smoke Ticket 1',
      priceCents: 10000,
      faceValueCents: 10000,
      image: 'https://example.com/ticket.jpg',
      venue: 'Test Venue',
      date: '2026-12-31 8:00 PM',
      status: TicketStatus.AVAILABLE,
      verificationStatus: TicketVerificationStatus.PENDING,
      barcodeHash,
      barcodeType: 'QR',
      barcodeLast4: '1234',
      sellerId: seller.id,
      eventId: event.id,
    },
  });

  const duplicate = await prisma.ticket.findFirst({
    where: {
      barcodeHash,
      status: { in: [TicketStatus.AVAILABLE, TicketStatus.SOLD] },
      verificationStatus: {
        in: [
          TicketVerificationStatus.PENDING,
          TicketVerificationStatus.VERIFIED,
          TicketVerificationStatus.NEEDS_REVIEW,
        ],
      },
      eventId: event.id,
    },
    select: { id: true },
  });

  const verified = await autoVerifyTicketById(prisma as any, t1.id);

  const queueSample = await prisma.ticket.findMany({
    where: { id: t1.id },
    select: {
      id: true,
      verificationStatus: true,
      verificationScore: true,
      verificationReason: true,
      barcodeType: true,
      barcodeLast4: true,
    },
  });

  console.log(JSON.stringify({
    ok: true,
    createdTicketId: t1.id,
    duplicateFound: !!duplicate,
    verifiedStatus: (verified as any)?.verificationStatus ?? null,
    queueSample,
  }, null, 2));

  await prisma.ticket.deleteMany({ where: { sellerId: seller.id } });
  await prisma.event.delete({ where: { id: event.id } });
  await prisma.seller.delete({ where: { id: seller.id } });
}

main().catch((e)=>{ console.error(e); process.exit(1); });
