import Link from "next/link";

type Ticket = {
  id: string;
  title: string;
  date: string;
  venue: string;
  price: number;
  sellerId: string;
};

export default function TicketCard({
  ticket,
}: {
  ticket: Ticket;
}) {
  return (
    <div className="bg-white rounded-xl shadow hover:shadow-xl transition">
      <div className="p-5 flex flex-col h-full">
        <h4 className="font-bold text-lg mb-1">
          {ticket.title}
        </h4>

        <p className="text-gray-600">{ticket.date}</p>
        <p className="text-gray-600 mb-3">{ticket.venue}</p>

        <p className="font-semibold text-blue-600 mb-4">
          ${ticket.price}
        </p>

        <div className="mt-auto flex gap-2">
          <Link
            href={`/ticket/${ticket.id}`}
            className="flex-1 text-center bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
          >
            View Ticket
          </Link>

          <Link
            href={`/seller/${ticket.sellerId}`}
            className="flex-1 text-center border border-blue-600 text-blue-600 py-2 rounded hover:bg-blue-50"
          >
            Seller
          </Link>
        </div>
      </div>
    </div>
  );
}
