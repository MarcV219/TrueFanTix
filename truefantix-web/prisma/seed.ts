import { TicketStatus, EventSelloutStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import { prisma } from '../src/lib/prisma';

async function main() {
  console.log('Seeding database...');

  // Create test sellers first
  const sellerPassword = await hash('password123', 10);
  
  // Create users and sellers
  const sellers = [];
  for (let i = 1; i <= 8; i++) {
    const user = await prisma.user.upsert({
      where: { email: `seller${i}@test.com` },
      update: {},
      create: {
        email: `seller${i}@test.com`,
        passwordHash: sellerPassword,
        firstName: `Seller${i}`,
        lastName: 'Test',
        phone: `+1${5550000000 + i}`,
        streetAddress1: `${i}23 Test St`,
        city: 'Toronto',
        region: 'ON',
        postalCode: `M5V ${i}A1`,
        country: 'CA',
        canSell: true,
        termsAcceptedAt: new Date(),
        privacyAcceptedAt: new Date(),
      },
    });

    const seller = await prisma.seller.upsert({
      where: { id: user.id },
      update: {},
      create: {
        id: user.id,
        name: `Seller ${i}`,
        rating: 4 + Math.random(),
        reviews: Math.floor(Math.random() * 50) + 5,
        status: 'APPROVED',
        statusUpdatedAt: new Date(),
      },
    });
    sellers.push(seller);
  }

  // Create diverse events
  const events = [
    // Concerts
    { title: "Taylor Swift - The Eras Tour", venue: "Rogers Centre, Toronto, ON, Canada", date: "2026-03-15", type: "concert", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "Drake - It's All A Blur Tour", venue: "Rogers Centre, Toronto, ON, Canada", date: "2026-05-20", type: "concert", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "Ed Sheeran Mathematics Tour", venue: "Budweiser Stage, Toronto, ON, Canada", date: "2026-04-10", type: "concert", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    { title: "The Weeknd - After Hours Tour", venue: "Scotiabank Arena, Toronto, ON, Canada", date: "2026-07-08", type: "concert", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "Adele - Weekend with Adele", venue: "Massey Hall, Toronto, ON, Canada", date: "2026-06-15", type: "concert", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "Beyoncé Renaissance World Tour", venue: "Rogers Centre, Toronto, ON, Canada", date: "2026-08-20", type: "concert", selloutStatus: EventSelloutStatus.SOLD_OUT },
    
    // Sports - Basketball
    { title: "Toronto Raptors vs Lakers", venue: "Scotiabank Arena, Toronto, ON, Canada", date: "2026-02-25", type: "basketball", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "Toronto Raptors vs Warriors", venue: "Scotiabank Arena, Toronto, ON, Canada", date: "2026-03-10", type: "basketball", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    { title: "Toronto Raptors vs Celtics", venue: "Scotiabank Arena, Toronto, ON, Canada", date: "2026-04-05", type: "basketball", selloutStatus: EventSelloutStatus.SOLD_OUT },
    
    // Sports - Hockey
    { title: "Toronto Maple Leafs vs Bruins", venue: "Scotiabank Arena, Toronto, ON, Canada", date: "2026-03-05", type: "hockey", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "Toronto Maple Leafs vs Canadiens", venue: "Scotiabank Arena, Toronto, ON, Canada", date: "2026-03-25", type: "hockey", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "Toronto Maple Leafs vs Rangers", venue: "Scotiabank Arena, Toronto, ON, Canada", date: "2026-04-12", type: "hockey", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    
    // Sports - Baseball
    { title: "Blue Jays vs Yankees", venue: "Rogers Centre, Toronto, ON, Canada", date: "2026-06-15", type: "baseball", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "Blue Jays vs Red Sox", venue: "Rogers Centre, Toronto, ON, Canada", date: "2026-07-22", type: "baseball", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    { title: "Blue Jays vs Dodgers", venue: "Rogers Centre, Toronto, ON, Canada", date: "2026-08-10", type: "baseball", selloutStatus: EventSelloutStatus.SOLD_OUT },
    
    // Sports - Football
    { title: "Toronto Argonauts vs Blue Bombers", venue: "BMO Field, Toronto, ON, Canada", date: "2026-09-15", type: "football", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    { title: "Toronto Argonauts vs Roughriders", venue: "BMO Field, Toronto, ON, Canada", date: "2026-10-05", type: "football", selloutStatus: EventSelloutStatus.SOLD_OUT },
    
    // Sports - Soccer
    { title: "Toronto FC vs Inter Miami", venue: "BMO Field, Toronto, ON, Canada", date: "2026-05-15", type: "soccer", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "Toronto FC vs LA Galaxy", venue: "BMO Field, Toronto, ON, Canada", date: "2026-07-20", type: "soccer", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    
    // Theatre
    { title: "Hamilton", venue: "Princess of Wales Theatre, Toronto, ON, Canada", date: "2026-03-01", type: "theatre", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "The Lion King", venue: "Princess of Wales Theatre, Toronto, ON, Canada", date: "2026-04-20", type: "theatre", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "Wicked", venue: "Ed Mirvish Theatre, Toronto, ON, Canada", date: "2026-05-15", type: "theatre", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "Mamma Mia!", venue: "Royal Alexandra Theatre, Toronto, ON, Canada", date: "2026-06-10", type: "theatre", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    
    // Comedy
    { title: "Dave Chappelle Live", venue: "Massey Hall, Toronto, ON, Canada", date: "2026-04-15", type: "comedy", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "Kevin Hart Reality Check", venue: "Scotiabank Arena, Toronto, ON, Canada", date: "2026-05-25", type: "comedy", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "John Mulaney Stand-Up", venue: "Sony Centre, Toronto, ON, Canada", date: "2026-06-20", type: "comedy", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    { title: "Ali Wong Comedy Night", venue: "Queen Elizabeth Theatre, Toronto, ON, Canada", date: "2026-07-10", type: "comedy", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "Jim Gaffigan Quality Time", venue: "Massey Hall, Toronto, ON, Canada", date: "2026-08-05", type: "comedy", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    
    // Opera
    { title: "La Bohème - Canadian Opera Company", venue: "Four Seasons Centre, Toronto, ON, Canada", date: "2026-04-25", type: "opera", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "The Magic Flute - COC", venue: "Four Seasons Centre, Toronto, ON, Canada", date: "2026-05-30", type: "opera", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    { title: "Carmen - Canadian Opera Company", venue: "Four Seasons Centre, Toronto, ON, Canada", date: "2026-10-15", type: "opera", selloutStatus: EventSelloutStatus.SOLD_OUT },
    
    // Festival
    { title: "Toronto International Film Festival", venue: "Multiple Venues, Toronto, ON, Canada", date: "2026-09-10", type: "festival", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "Canadian Music Week", venue: "Various Venues, Toronto, ON, Canada", date: "2026-05-05", type: "festival", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    { title: "Toronto Jazz Festival", venue: "Nathan Phillips Square, Toronto, ON, Canada", date: "2026-06-25", type: "festival", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    
    // Conference
    { title: "Collision Conference 2026", venue: "Enercare Centre, Toronto, ON, Canada", date: "2026-06-20", type: "conference", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "Toronto Tech Summit", venue: "Metro Toronto Convention Centre, Toronto, ON, Canada", date: "2026-04-15", type: "conference", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    { title: "Design Thinkers Conference", venue: "Sony Centre, Toronto, ON, Canada", date: "2026-05-12", type: "conference", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    
    // Gala
    { title: "Toronto Symphony Orchestra Gala", venue: "Roy Thomson Hall, Toronto, ON, Canada", date: "2026-09-20", type: "gala", selloutStatus: EventSelloutStatus.SOLD_OUT },
    { title: "Canadian Cancer Society Gala", venue: "Fairmont Royal York, Toronto, ON, Canada", date: "2026-10-25", type: "gala", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    { title: "SickKids Hospital Foundation Gala", venue: "Metro Toronto Convention Centre, Toronto, ON, Canada", date: "2026-11-15", type: "gala", selloutStatus: EventSelloutStatus.SOLD_OUT },
    
    // Workshop
    { title: "Creative Writing Workshop", venue: "Toronto Public Library, Toronto, ON, Canada", date: "2026-03-20", type: "workshop", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    { title: "Photography Masterclass", venue: "George Brown College, Toronto, ON, Canada", date: "2026-04-10", type: "workshop", selloutStatus: EventSelloutStatus.NOT_SOLD_OUT },
    { title: "Entrepreneurship Bootcamp", venue: "MaRS Discovery District, Toronto, ON, Canada", date: "2026-05-15", type: "workshop", selloutStatus: EventSelloutStatus.SOLD_OUT },
  ];

  const createdEvents = [];
  for (const eventData of events) {
    try {
      const event = await prisma.event.create({
        data: {
          title: eventData.title,
          venue: eventData.venue,
          date: eventData.date,
          selloutStatus: eventData.selloutStatus,
        },
      });
      createdEvents.push(event);
    } catch (e) {
      console.log(`Event ${eventData.title} creation skipped:`, (e as Error).message);
    }
  }

  // Helper function to get image based on event type
  function getImageForEventType(type: string): string {
    const imageMap: Record<string, string> = {
      concert: '/concert-placeholder.jpg',
      basketball: '/basketball-placeholder.jpg',
      hockey: '/hockey-placeholder.jpg',
      baseball: '/sports-placeholder.jpg',
      football: '/football-placeholder.jpg',
      soccer: '/sports-placeholder.jpg',
      theatre: '/theatre-placeholder.jpg',
      comedy: '/comedy-placeholder.jpg',
      opera: '/opera-placeholder.jpg',
      festival: '/festival-placeholder.jpg',
      conference: '/conference-placeholder.jpg',
      gala: '/gala-placeholder.jpg',
      workshop: '/workshop-placeholder.jpg',
    };
    return imageMap[type] || '/default.jpg';
  }

  // Create diverse tickets - 5-6 per category with proper price/faceValue relationships
  const ticketData = [
    // Taylor Swift - Concert (SOLD_OUT) - Some at face value, some below
    { eventIdx: 0, priceCents: 15000, faceValueCents: 15000, title: "Taylor Swift - Floor Seats", row: "A", seat: "12", image: getImageForEventType('concert') },
    { eventIdx: 0, priceCents: 12000, faceValueCents: 14000, title: "Taylor Swift - Lower Bowl", row: "K", seat: "24", image: getImageForEventType('concert') },
    { eventIdx: 0, priceCents: 9500, faceValueCents: 10000, title: "Taylor Swift - Upper Level", row: "300", seat: "A-15", image: getImageForEventType('concert') },
    { eventIdx: 0, priceCents: 20000, faceValueCents: 20000, title: "Taylor Swift - VIP Package", row: "VIP", seat: "3", image: getImageForEventType('concert') },
    { eventIdx: 0, priceCents: 8500, faceValueCents: 9500, title: "Taylor Swift - Side View", row: "215", seat: "8", image: getImageForEventType('concert') },
    { eventIdx: 0, priceCents: 5000, faceValueCents: 7500, title: "Taylor Swift - Nosebleeds", row: "526", seat: "44", image: getImageForEventType('concert') },
    
    // Drake - Concert (SOLD_OUT)
    { eventIdx: 1, priceCents: 18000, faceValueCents: 18000, title: "Drake - Floor", row: "B", seat: "45", image: getImageForEventType('concert') },
    { eventIdx: 1, priceCents: 9500, faceValueCents: 11000, title: "Drake - Lower Bowl", row: "22", seat: "18", image: getImageForEventType('concert') },
    { eventIdx: 1, priceCents: 5500, faceValueCents: 6500, title: "Drake - Upper Level", row: "527", seat: "12", image: getImageForEventType('concert') },
    { eventIdx: 1, priceCents: 25000, faceValueCents: 30000, title: "Drake - VIP Meet & Greet", row: "VIP", seat: "1", image: getImageForEventType('concert') },
    { eventIdx: 1, priceCents: 7500, faceValueCents: 8500, title: "Drake - Club Level", row: "CLUB", seat: "15", image: getImageForEventType('concert') },
    
    // Ed Sheeran - Concert (NOT SOLD OUT)
    { eventIdx: 2, priceCents: 6500, faceValueCents: 7500, title: "Ed Sheeran - Pit", row: "GA", seat: "PIT-45", image: getImageForEventType('concert') },
    { eventIdx: 2, priceCents: 4500, faceValueCents: 5000, title: "Ed Sheeran - Reserved Seating", row: "B", seat: "18", image: getImageForEventType('concert') },
    { eventIdx: 2, priceCents: 3500, faceValueCents: 4000, title: "Ed Sheeran - Lawn", row: "LAWN", seat: "GA", image: getImageForEventType('concert') },
    { eventIdx: 2, priceCents: 5500, faceValueCents: 5500, title: "Ed Sheeran - Club Seats", row: "CLUB", seat: "25", image: getImageForEventType('concert') },
    { eventIdx: 2, priceCents: 3000, faceValueCents: 4500, title: "Ed Sheeran - General Admission", row: "GA", seat: "145", image: getImageForEventType('concert') },
    
    // The Weeknd - Concert (SOLD_OUT)
    { eventIdx: 3, priceCents: 15000, faceValueCents: 18000, title: "The Weeknd - Floor", row: "C", seat: "30", image: getImageForEventType('concert') },
    { eventIdx: 3, priceCents: 8500, faceValueCents: 9500, title: "The Weeknd - Lower Bowl", row: "18", seat: "22", image: getImageForEventType('concert') },
    { eventIdx: 3, priceCents: 9500, faceValueCents: 9500, title: "The Weeknd - Premium Lower", row: "12", seat: "8", image: getImageForEventType('concert') },
    { eventIdx: 3, priceCents: 6000, faceValueCents: 7500, title: "The Weeknd - Upper Bowl", row: "312", seat: "45", image: getImageForEventType('concert') },
    
    // Adele - Concert (SOLD_OUT)
    { eventIdx: 4, priceCents: 25000, faceValueCents: 25000, title: "Adele - Orchestra Front", row: "AA", seat: "10", image: getImageForEventType('concert') },
    { eventIdx: 4, priceCents: 18000, faceValueCents: 20000, title: "Adele - Orchestra Rear", row: "M", seat: "22", image: getImageForEventType('concert') },
    { eventIdx: 4, priceCents: 12000, faceValueCents: 15000, title: "Adele - Balcony", row: "BALC", seat: "15", image: getImageForEventType('concert') },
    { eventIdx: 4, priceCents: 35000, faceValueCents: 40000, title: "Adele - VIP Experience", row: "VIP", seat: "1", image: getImageForEventType('concert') },
    
    // Beyoncé - Concert (SOLD_OUT)
    { eventIdx: 5, priceCents: 22000, faceValueCents: 22000, title: "Beyoncé - Floor Center", row: "A", seat: "15", image: getImageForEventType('concert') },
    { eventIdx: 5, priceCents: 18000, faceValueCents: 20000, title: "Beyoncé - Floor Side", row: "D", seat: "28", image: getImageForEventType('concert') },
    { eventIdx: 5, priceCents: 14000, faceValueCents: 16000, title: "Beyoncé - Lower Bowl", row: "J", seat: "12", image: getImageForEventType('concert') },
    { eventIdx: 5, priceCents: 8000, faceValueCents: 10000, title: "Beyoncé - Upper Level", row: "425", seat: "33", image: getImageForEventType('concert') },
    
    // Raptors vs Lakers - Basketball (SOLD_OUT)
    { eventIdx: 6, priceCents: 8500, faceValueCents: 9500, title: "Raptors vs Lakers - Courtside", row: "1", seat: "A-8", image: getImageForEventType('basketball') },
    { eventIdx: 6, priceCents: 4500, faceValueCents: 5000, title: "Raptors vs Lakers - Lower Bowl", row: "15", seat: "12", image: getImageForEventType('basketball') },
    { eventIdx: 6, priceCents: 2500, faceValueCents: 2800, title: "Raptors vs Lakers - Upper Level", row: "312", seat: "8", image: getImageForEventType('basketball') },
    { eventIdx: 6, priceCents: 15000, faceValueCents: 15000, title: "Raptors vs Lakers - VIP Courtside", row: "COURT", seat: "VIP-2", image: getImageForEventType('basketball') },
    { eventIdx: 6, priceCents: 3800, faceValueCents: 4200, title: "Raptors vs Lakers - Club Level", row: "CLUB", seat: "25", image: getImageForEventType('basketball') },
    
    // Raptors vs Warriors - Basketball (NOT SOLD OUT)
    { eventIdx: 7, priceCents: 3500, faceValueCents: 4000, title: "Raptors vs Warriors - Lower Bowl", row: "20", seat: "15", image: getImageForEventType('basketball') },
    { eventIdx: 7, priceCents: 1800, faceValueCents: 2200, title: "Raptors vs Warriors - Upper Level", row: "320", seat: "10", image: getImageForEventType('basketball') },
    { eventIdx: 7, priceCents: 5500, faceValueCents: 5500, title: "Raptors vs Warriors - Club Seats", row: "CLUB", seat: "30", image: getImageForEventType('basketball') },
    { eventIdx: 7, priceCents: 12000, faceValueCents: 14000, title: "Raptors vs Warriors - Courtside", row: "1", seat: "A-5", image: getImageForEventType('basketball') },
    
    // Raptors vs Celtics - Basketball (SOLD_OUT)
    { eventIdx: 8, priceCents: 5000, faceValueCents: 5500, title: "Raptors vs Celtics - Lower Bowl", row: "12", seat: "8", image: getImageForEventType('basketball') },
    { eventIdx: 8, priceCents: 2800, faceValueCents: 3200, title: "Raptors vs Celtics - Upper Level", row: "315", seat: "22", image: getImageForEventType('basketball') },
    { eventIdx: 8, priceCents: 9500, faceValueCents: 10000, title: "Raptors vs Celtics - Courtside", row: "1", seat: "A-12", image: getImageForEventType('basketball') },
    
    // Maple Leafs vs Bruins - Hockey (SOLD_OUT)
    { eventIdx: 9, priceCents: 12000, faceValueCents: 15000, title: "Leafs vs Bruins - Lower Bowl", row: "8", seat: "14", image: getImageForEventType('hockey') },
    { eventIdx: 9, priceCents: 5500, faceValueCents: 6500, title: "Leafs vs Bruins - Upper Level", row: "301", seat: "22", image: getImageForEventType('hockey') },
    { eventIdx: 9, priceCents: 22000, faceValueCents: 22000, title: "Leafs vs Bruins - Platinum Seats", row: "4", seat: "8-9", image: getImageForEventType('hockey') },
    { eventIdx: 9, priceCents: 7500, faceValueCents: 8500, title: "Leafs vs Bruins - Club Level", row: "CLUB", seat: "45", image: getImageForEventType('hockey') },
    { eventIdx: 9, priceCents: 3500, faceValueCents: 4500, title: "Leafs vs Bruins - Upper Corner", row: "322", seat: "15", image: getImageForEventType('hockey') },
    
    // Maple Leafs vs Canadiens - Hockey (SOLD_OUT)
    { eventIdx: 10, priceCents: 14000, faceValueCents: 16000, title: "Leafs vs Canadiens - Lower Bowl", row: "10", seat: "12", image: getImageForEventType('hockey') },
    { eventIdx: 10, priceCents: 6500, faceValueCents: 7500, title: "Leafs vs Canadiens - Upper Level", row: "305", seat: "18", image: getImageForEventType('hockey') },
    { eventIdx: 10, priceCents: 25000, faceValueCents: 28000, title: "Leafs vs Canadiens - Platinum", row: "3", seat: "5-6", image: getImageForEventType('hockey') },
    { eventIdx: 10, priceCents: 8500, faceValueCents: 9000, title: "Leafs vs Canadiens - Club", row: "CLUB", seat: "30", image: getImageForEventType('hockey') },
    
    // Maple Leafs vs Rangers - Hockey (NOT SOLD OUT)
    { eventIdx: 11, priceCents: 4500, faceValueCents: 5500, title: "Leafs vs Rangers - Lower Bowl", row: "18", seat: "25", image: getImageForEventType('hockey') },
    { eventIdx: 11, priceCents: 2200, faceValueCents: 2800, title: "Leafs vs Rangers - Upper Level", row: "318", seat: "12", image: getImageForEventType('hockey') },
    { eventIdx: 11, priceCents: 8000, faceValueCents: 8000, title: "Leafs vs Rangers - Club Seats", row: "CLUB", seat: "20", image: getImageForEventType('hockey') },
    
    // Blue Jays vs Yankees - Baseball (SOLD_OUT)
    { eventIdx: 12, priceCents: 4500, faceValueCents: 5500, title: "Blue Jays vs Yankees - 100 Level", row: "24", seat: "8", image: getImageForEventType('baseball') },
    { eventIdx: 12, priceCents: 2500, faceValueCents: 3000, title: "Blue Jays vs Yankees - 500 Level", row: "534", seat: "15", image: getImageForEventType('baseball') },
    { eventIdx: 12, priceCents: 8000, faceValueCents: 9000, title: "Blue Jays vs Yankees - Field Level", row: "12", seat: "3", image: getImageForEventType('baseball') },
    { eventIdx: 12, priceCents: 3500, faceValueCents: 4000, title: "Blue Jays vs Yankees - 200 Level", row: "220", seat: "28", image: getImageForEventType('baseball') },
    { eventIdx: 12, priceCents: 12000, faceValueCents: 12000, title: "Blue Jays vs Yankees - VIP Suite", row: "SUITE", seat: "A", image: getImageForEventType('baseball') },
    
    // Blue Jays vs Red Sox - Baseball (NOT SOLD OUT)
    { eventIdx: 13, priceCents: 3500, faceValueCents: 4500, title: "Blue Jays vs Red Sox - 100 Level", row: "28", seat: "12", image: getImageForEventType('baseball') },
    { eventIdx: 13, priceCents: 1800, faceValueCents: 2500, title: "Blue Jays vs Red Sox - 500 Level", row: "540", seat: "8", image: getImageForEventType('baseball') },
    { eventIdx: 13, priceCents: 6500, faceValueCents: 7500, title: "Blue Jays vs Red Sox - Field Level", row: "15", seat: "5", image: getImageForEventType('baseball') },
    { eventIdx: 13, priceCents: 2200, faceValueCents: 3500, title: "Blue Jays vs Red Sox - 200 Level", row: "215", seat: "18", image: getImageForEventType('baseball') },
    
    // Blue Jays vs Dodgers - Baseball (SOLD_OUT)
    { eventIdx: 14, priceCents: 5500, faceValueCents: 6500, title: "Blue Jays vs Dodgers - 100 Level", row: "20", seat: "10", image: getImageForEventType('baseball') },
    { eventIdx: 14, priceCents: 3000, faceValueCents: 3500, title: "Blue Jays vs Dodgers - 500 Level", row: "528", seat: "22", image: getImageForEventType('baseball') },
    { eventIdx: 14, priceCents: 9500, faceValueCents: 10000, title: "Blue Jays vs Dodgers - Field Level", row: "8", seat: "2", image: getImageForEventType('baseball') },
    { eventIdx: 14, priceCents: 7500, faceValueCents: 7500, title: "Blue Jays vs Dodgers - 200 Level", row: "205", seat: "15", image: getImageForEventType('baseball') },
    
    // Argonauts vs Blue Bombers - Football (NOT SOLD OUT)
    { eventIdx: 15, priceCents: 6500, faceValueCents: 7500, title: "Argos vs Blue Bombers - Lower Bowl", row: "15", seat: "20", image: getImageForEventType('football') },
    { eventIdx: 15, priceCents: 3500, faceValueCents: 4500, title: "Argos vs Blue Bombers - Upper Level", row: "220", seat: "15", image: getImageForEventType('football') },
    { eventIdx: 15, priceCents: 12000, faceValueCents: 14000, title: "Argos vs Blue Bombers - Field Level", row: "5", seat: "8", image: getImageForEventType('football') },
    { eventIdx: 15, priceCents: 2500, faceValueCents: 4000, title: "Argos vs Blue Bombers - End Zone", row: "END", seat: "45", image: getImageForEventType('football') },
    
    // Argonauts vs Roughriders - Football (SOLD_OUT)
    { eventIdx: 16, priceCents: 7500, faceValueCents: 8500, title: "Argos vs Roughriders - Lower Bowl", row: "12", seat: "18", image: getImageForEventType('football') },
    { eventIdx: 16, priceCents: 4200, faceValueCents: 5000, title: "Argos vs Roughriders - Upper Level", row: "215", seat: "22", image: getImageForEventType('football') },
    { eventIdx: 16, priceCents: 14000, faceValueCents: 15000, title: "Argos vs Roughriders - Field Level", row: "3", seat: "12", image: getImageForEventType('football') },
    { eventIdx: 16, priceCents: 3200, faceValueCents: 4500, title: "Argos vs Roughriders - End Zone", row: "END", seat: "38", image: getImageForEventType('football') },
    
    // Toronto FC vs Inter Miami - Soccer (SOLD_OUT)
    { eventIdx: 17, priceCents: 4500, faceValueCents: 5500, title: "TFC vs Inter Miami - West Stand", row: "12", seat: "25", image: getImageForEventType('soccer') },
    { eventIdx: 17, priceCents: 2800, faceValueCents: 3500, title: "TFC vs Inter Miami - East Stand", row: "25", seat: "18", image: getImageForEventType('soccer') },
    { eventIdx: 17, priceCents: 8000, faceValueCents: 9000, title: "TFC vs Inter Miami - South End", row: "SUPP", seat: "C2", image: getImageForEventType('soccer') },
    { eventIdx: 17, priceCents: 6500, faceValueCents: 6500, title: "TFC vs Inter Miami - North End", row: "NORTH", seat: "G10", image: getImageForEventType('soccer') },
    { eventIdx: 17, priceCents: 3800, faceValueCents: 4500, title: "TFC vs Inter Miami - Family Zone", row: "FZ", seat: "30", image: getImageForEventType('soccer') },
    
    // Toronto FC vs LA Galaxy - Soccer (NOT SOLD OUT)
    { eventIdx: 18, priceCents: 3500, faceValueCents: 4500, title: "TFC vs LA Galaxy - West Stand", row: "18", seat: "22", image: getImageForEventType('soccer') },
    { eventIdx: 18, priceCents: 2000, faceValueCents: 2800, title: "TFC vs LA Galaxy - East Stand", row: "30", seat: "10", image: getImageForEventType('soccer') },
    { eventIdx: 18, priceCents: 5000, faceValueCents: 5000, title: "TFC vs LA Galaxy - South End", row: "SUPP", seat: "D5", image: getImageForEventType('soccer') },
    { eventIdx: 18, priceCents: 2500, faceValueCents: 3500, title: "TFC vs LA Galaxy - North End", row: "NORTH", seat: "K12", image: getImageForEventType('soccer') },
    
    // Hamilton - Theatre (SOLD_OUT)
    { eventIdx: 19, priceCents: 18000, faceValueCents: 20000, title: "Hamilton - Orchestra", row: "E", seat: "10", image: getImageForEventType('theatre') },
    { eventIdx: 19, priceCents: 12000, faceValueCents: 14000, title: "Hamilton - Mezzanine", row: "AA", seat: "15", image: getImageForEventType('theatre') },
    { eventIdx: 19, priceCents: 7500, faceValueCents: 8500, title: "Hamilton - Balcony", row: "BALC", seat: "22", image: getImageForEventType('theatre') },
    { eventIdx: 19, priceCents: 25000, faceValueCents: 30000, title: "Hamilton - Front Row VIP", row: "A", seat: "1", image: getImageForEventType('theatre') },
    { eventIdx: 19, priceCents: 15000, faceValueCents: 15000, title: "Hamilton - Dress Circle", row: "DRCS", seat: "5", image: getImageForEventType('theatre') },
    
    // The Lion King - Theatre (SOLD_OUT)
    { eventIdx: 20, priceCents: 16000, faceValueCents: 18000, title: "The Lion King - Orchestra", row: "F", seat: "8", image: getImageForEventType('theatre') },
    { eventIdx: 20, priceCents: 10000, faceValueCents: 12000, title: "The Lion King - Mezzanine", row: "BB", seat: "20", image: getImageForEventType('theatre') },
    { eventIdx: 20, priceCents: 6000, faceValueCents: 7500, title: "The Lion King - Balcony", row: "BALC", seat: "30", image: getImageForEventType('theatre') },
    { eventIdx: 20, priceCents: 20000, faceValueCents: 20000, title: "The Lion King - Premium Orchestra", row: "C", seat: "15", image: getImageForEventType('theatre') },
    
    // Wicked - Theatre (SOLD_OUT)
    { eventIdx: 21, priceCents: 17000, faceValueCents: 19000, title: "Wicked - Orchestra", row: "H", seat: "14", image: getImageForEventType('theatre') },
    { eventIdx: 21, priceCents: 11000, faceValueCents: 13000, title: "Wicked - Mezzanine", row: "CC", seat: "10", image: getImageForEventType('theatre') },
    { eventIdx: 21, priceCents: 6500, faceValueCents: 8000, title: "Wicked - Balcony", row: "BALC", seat: "25", image: getImageForEventType('theatre') },
    { eventIdx: 21, priceCents: 22000, faceValueCents: 22000, title: "Wicked - Front Mezzanine", row: "MZZF", seat: "8", image: getImageForEventType('theatre') },
    
    // Mamma Mia! - Theatre (NOT SOLD OUT)
    { eventIdx: 22, priceCents: 9000, faceValueCents: 11000, title: "Mamma Mia! - Orchestra", row: "G", seat: "18", image: getImageForEventType('theatre') },
    { eventIdx: 22, priceCents: 5500, faceValueCents: 7000, title: "Mamma Mia! - Mezzanine", row: "AA", seat: "12", image: getImageForEventType('theatre') },
    { eventIdx: 22, priceCents: 3000, faceValueCents: 4500, title: "Mamma Mia! - Balcony", row: "BALC", seat: "35", image: getImageForEventType('theatre') },
    { eventIdx: 22, priceCents: 7500, faceValueCents: 7500, title: "Mamma Mia! - Dress Circle", row: "DRCS", seat: "10", image: getImageForEventType('theatre') },
    
    // Dave Chappelle Live - Comedy (SOLD_OUT)
    { eventIdx: 23, priceCents: 12000, faceValueCents: 14000, title: "Dave Chappelle - Floor Seats", row: "A", seat: "20", image: getImageForEventType('comedy') },
    { eventIdx: 23, priceCents: 7000, faceValueCents: 8500, title: "Dave Chappelle - Lower Bowl", row: "10", seat: "15", image: getImageForEventType('comedy') },
    { eventIdx: 23, priceCents: 4000, faceValueCents: 5000, title: "Dave Chappelle - Upper Level", row: "308", seat: "28", image: getImageForEventType('comedy') },
    { eventIdx: 23, priceCents: 15000, faceValueCents: 15000, title: "Dave Chappelle - Front Row", row: "FRONT", seat: "5", image: getImageForEventType('comedy') },
    { eventIdx: 23, priceCents: 5500, faceValueCents: 6500, title: "Dave Chappelle - Balcony", row: "BALC", seat: "10", image: getImageForEventType('comedy') },
    
    // Kevin Hart Reality Check - Comedy (SOLD_OUT)
    { eventIdx: 24, priceCents: 9000, faceValueCents: 11000, title: "Kevin Hart - Floor", row: "B", seat: "30", image: getImageForEventType('comedy') },
    { eventIdx: 24, priceCents: 5000, faceValueCents: 6000, title: "Kevin Hart - Lower Bowl", row: "15", seat: "10", image: getImageForEventType('comedy') },
    { eventIdx: 24, priceCents: 2500, faceValueCents: 3500, title: "Kevin Hart - Upper Level", row: "410", seat: "18", image: getImageForEventType('comedy') },
    { eventIdx: 24, priceCents: 12000, faceValueCents: 12000, title: "Kevin Hart - VIP Package", row: "VIP", seat: "2", image: getImageForEventType('comedy') },
    
    // John Mulaney Stand-Up - Comedy (NOT SOLD OUT)
    { eventIdx: 25, priceCents: 7000, faceValueCents: 8500, title: "John Mulaney - Orchestra", row: "C", seat: "12", image: getImageForEventType('comedy') },
    { eventIdx: 25, priceCents: 4000, faceValueCents: 5000, title: "John Mulaney - Balcony", row: "BALC", seat: "20", image: getImageForEventType('comedy') },
    { eventIdx: 25, priceCents: 2000, faceValueCents: 3000, title: "John Mulaney - Upper Balcony", row: "UPBALC", seat: "5", image: getImageForEventType('comedy') },
    { eventIdx: 25, priceCents: 5500, faceValueCents: 5500, title: "John Mulaney - Dress Circle", row: "DRCS", seat: "8", image: getImageForEventType('comedy') },
    
    // Ali Wong Comedy Night - Comedy (SOLD_OUT)
    { eventIdx: 26, priceCents: 8000, faceValueCents: 9500, title: "Ali Wong - Orchestra", row: "F", seat: "10", image: getImageForEventType('comedy') },
    { eventIdx: 26, priceCents: 4500, faceValueCents: 5500, title: "Ali Wong - Balcony", row: "BALC", seat: "15", image: getImageForEventType('comedy') },
    { eventIdx: 26, priceCents: 10000, faceValueCents: 10000, title: "Ali Wong - VIP Front Row", row: "A", seat: "3", image: getImageForEventType('comedy') },
    
    // Jim Gaffigan Quality Time - Comedy (NOT SOLD OUT)
    { eventIdx: 27, priceCents: 6000, faceValueCents: 7000, title: "Jim Gaffigan - Orchestra", row: "D", seat: "18", image: getImageForEventType('comedy') },
    { eventIdx: 27, priceCents: 3500, faceValueCents: 4500, title: "Jim Gaffigan - Balcony", row: "BALC", seat: "22", image: getImageForEventType('comedy') },
    { eventIdx: 27, priceCents: 5000, faceValueCents: 5000, title: "Jim Gaffigan - Dress Circle", row: "DRCS", seat: "10", image: getImageForEventType('comedy') },
    
    // La Bohème - Opera (SOLD_OUT)
    { eventIdx: 28, priceCents: 15000, faceValueCents: 17000, title: "La Bohème - Orchestra Premium", row: "A", seat: "8", image: getImageForEventType('opera') },
    { eventIdx: 28, priceCents: 9000, faceValueCents: 10000, title: "La Bohème - Mezzanine", row: "G", seat: "12", image: getImageForEventType('opera') },
    { eventIdx: 28, priceCents: 5000, faceValueCents: 6500, title: "La Bohème - Balcony", row: "BALC", seat: "20", image: getImageForEventType('opera') },
    { eventIdx: 28, priceCents: 20000, faceValueCents: 20000, title: "La Bohème - Founders Circle", row: "FC", seat: "2", image: getImageForEventType('opera') },
    
    // The Magic Flute - Opera (NOT SOLD OUT)
    { eventIdx: 29, priceCents: 10000, faceValueCents: 12000, title: "The Magic Flute - Orchestra", row: "D", seat: "15", image: getImageForEventType('opera') },
    { eventIdx: 29, priceCents: 6000, faceValueCents: 7500, title: "The Magic Flute - Mezzanine", row: "H", seat: "10", image: getImageForEventType('opera') },
    { eventIdx: 29, priceCents: 3500, faceValueCents: 4500, title: "The Magic Flute - Balcony", row: "BALC", seat: "25", image: getImageForEventType('opera') },
    { eventIdx: 29, priceCents: 7500, faceValueCents: 7500, title: "The Magic Flute - Dress Circle", row: "DRCS", seat: "18", image: getImageForEventType('opera') },
    
    // Carmen - Opera (SOLD_OUT)
    { eventIdx: 30, priceCents: 16000, faceValueCents: 18000, title: "Carmen - Orchestra Center", row: "B", seat: "10", image: getImageForEventType('opera') },
    { eventIdx: 30, priceCents: 9500, faceValueCents: 11000, title: "Carmen - Mezzanine Side", row: "E", seat: "22", image: getImageForEventType('opera') },
    { eventIdx: 30, priceCents: 5500, faceValueCents: 7000, title: "Carmen - Upper Balcony", row: "UPBALC", seat: "15", image: getImageForEventType('opera') },
    { eventIdx: 30, priceCents: 22000, faceValueCents: 22000, title: "Carmen - Grand Tier Box", row: "BOX", seat: "GT1", image: getImageForEventType('opera') },
    
    // Toronto International Film Festival - Festival (SOLD_OUT)
    { eventIdx: 31, priceCents: 10000, faceValueCents: 10000, title: "TIFF - Opening Gala Premiere", row: "GA", seat: "PREM", image: getImageForEventType('festival') },
    { eventIdx: 31, priceCents: 6000, faceValueCents: 7500, title: "TIFF - Screening + Q&A", row: "BALC", seat: "10", image: getImageForEventType('festival') },
    { eventIdx: 31, priceCents: 3000, faceValueCents: 4000, title: "TIFF - Film Screening Pass", row: "GA", seat: "REG", image: getImageForEventType('festival') },
    { eventIdx: 31, priceCents: 15000, faceValueCents: 18000, title: "TIFF - Industry Pass", row: "VIP", seat: "IND", image: getImageForEventType('festival') },
    
    // Canadian Music Week - Festival (NOT SOLD OUT)
    { eventIdx: 32, priceCents: 2000, faceValueCents: 3000, title: "CMW - Day Pass", row: "GA", seat: "DAY", image: getImageForEventType('festival') },
    { eventIdx: 32, priceCents: 5000, faceValueCents: 6500, title: "CMW - Full Festival Pass", row: "GA", seat: "FULL", image: getImageForEventType('festival') },
    { eventIdx: 32, priceCents: 1000, faceValueCents: 1500, title: "CMW - Evening Showcase", row: "GA", seat: "EVE", image: getImageForEventType('festival') },
    { eventIdx: 32, priceCents: 3500, faceValueCents: 3500, title: "CMW - VIP Showcase", row: "VIP", seat: "SHOW", image: getImageForEventType('festival') },
    
    // Toronto Jazz Festival - Festival (NOT SOLD OUT)
    { eventIdx: 33, priceCents: 3000, faceValueCents: 4000, title: "Jazz Fest - Main Stage Access", row: "GA", seat: "MAIN", image: getImageForEventType('festival') },
    { eventIdx: 33, priceCents: 1500, faceValueCents: 2500, title: "Jazz Fest - Club Series Ticket", row: "CLUB", seat: "TBL1", image: getImageForEventType('festival') },
    { eventIdx: 33, priceCents: 6000, faceValueCents: 7500, title: "Jazz Fest - Weekend Pass", row: "GA", seat: "WKND", image: getImageForEventType('festival') },
    { eventIdx: 33, priceCents: 4500, faceValueCents: 4500, title: "Jazz Fest - VIP Lounge", row: "VIP", seat: "LOUNGE", image: getImageForEventType('festival') },
    
    // Collision Conference 2026 - Conference (SOLD_OUT)
    { eventIdx: 34, priceCents: 80000, faceValueCents: 95000, title: "Collision - Full Access Pass", row: "GA", seat: "FULL", image: getImageForEventType('conference') },
    { eventIdx: 34, priceCents: 40000, faceValueCents: 50000, title: "Collision - Exhibitor Pass", row: "EXH", seat: "BOOTH", image: getImageForEventType('conference') },
    { eventIdx: 34, priceCents: 120000, faceValueCents: 120000, title: "Collision - Investor Pass", row: "VIP", seat: "INV", image: getImageForEventType('conference') },
    
    // Toronto Tech Summit - Conference (NOT SOLD OUT)
    { eventIdx: 35, priceCents: 20000, faceValueCents: 25000, title: "Tech Summit - Standard Pass", row: "GA", seat: "STD", image: getImageForEventType('conference') },
    { eventIdx: 35, priceCents: 10000, faceValueCents: 15000, title: "Tech Summit - Student Pass", row: "GA", seat: "STUDENT", image: getImageForEventType('conference') },
    { eventIdx: 35, priceCents: 30000, faceValueCents: 30000, title: "Tech Summit - VIP Pass", row: "VIP", seat: "V01", image: getImageForEventType('conference') },
    
    // Design Thinkers Conference - Conference (NOT SOLD OUT)
    { eventIdx: 36, priceCents: 25000, faceValueCents: 30000, title: "Design Thinkers - Conference Pass", row: "GA", seat: "CONF", image: getImageForEventType('conference') },
    { eventIdx: 36, priceCents: 15000, faceValueCents: 20000, title: "Design Thinkers - Workshop Only", row: "WKSHP", seat: "SESS1", image: getImageForEventType('conference') },
    { eventIdx: 36, priceCents: 40000, faceValueCents: 40000, title: "Design Thinkers - All Access", row: "VIP", seat: "ALL", image: getImageForEventType('conference') },
    
    // Toronto Symphony Orchestra Gala - Gala (SOLD_OUT)
    { eventIdx: 37, priceCents: 25000, faceValueCents: 25000, title: "TSO Gala - Dinner & Concert", row: "TABLE", seat: "1A", image: getImageForEventType('gala') },
    { eventIdx: 37, priceCents: 15000, faceValueCents: 18000, title: "TSO Gala - Concert Only", row: "ORCH", seat: "B10", image: getImageForEventType('gala') },
    { eventIdx: 37, priceCents: 35000, faceValueCents: 40000, title: "TSO Gala - VIP Table", row: "TABLE", seat: "VIP-C", image: getImageForEventType('gala') },
    
    // Canadian Cancer Society Gala - Gala (NOT SOLD OUT)
    { eventIdx: 38, priceCents: 18000, faceValueCents: 20000, title: "CCS Gala - Dinner Ticket", row: "TABLE", seat: "5D", image: getImageForEventType('gala') },
    { eventIdx: 38, priceCents: 10000, faceValueCents: 12000, title: "CCS Gala - Reception Only", row: "RECEPT", seat: "GA", image: getImageForEventType('gala') },
    { eventIdx: 38, priceCents: 25000, faceValueCents: 25000, title: "CCS Gala - Patron Ticket", row: "PATRON", seat: "1", image: getImageForEventType('gala') },
    
    // SickKids Hospital Foundation Gala - Gala (SOLD_OUT)
    { eventIdx: 39, priceCents: 30000, faceValueCents: 35000, title: "SickKids Gala - VIP Table", row: "TABLE", seat: "2B", image: getImageForEventType('gala') },
    { eventIdx: 39, priceCents: 20000, faceValueCents: 20000, title: "SickKids Gala - Dinner Ticket", row: "TABLE", seat: "8C", image: getImageForEventType('gala') },
    { eventIdx: 39, priceCents: 45000, faceValueCents: 50000, title: "SickKids Gala - Founders Circle", row: "FC", seat: "A", image: getImageForEventType('gala') },
    
    // Creative Writing Workshop - Workshop (NOT SOLD OUT)
    { eventIdx: 40, priceCents: 1500, faceValueCents: 2000, title: "Writing Workshop - Full Day", row: "WRKSP", seat: "A1", image: getImageForEventType('workshop') },
    { eventIdx: 40, priceCents: 800, faceValueCents: 1200, title: "Writing Workshop - Half Day", row: "WRKSP", seat: "PM", image: getImageForEventType('workshop') },
    { eventIdx: 40, priceCents: 2500, faceValueCents: 2500, title: "Writing Workshop - Masterclass", row: "MASTER", seat: "M1", image: getImageForEventType('workshop') },
    
    // Photography Masterclass - Workshop (NOT SOLD OUT)
    { eventIdx: 41, priceCents: 2000, faceValueCents: 2500, title: "Photography Masterclass - Studio", row: "STUDIO", seat: "PH1", image: getImageForEventType('workshop') },
    { eventIdx: 41, priceCents: 1200, faceValueCents: 1800, title: "Photography Masterclass - Outdoor", row: "OUTDR", seat: "PH2", image: getImageForEventType('workshop') },
    { eventIdx: 41, priceCents: 3000, faceValueCents: 3000, title: "Photography Masterclass - Advanced", row: "ADV", seat: "PH3", image: getImageForEventType('workshop') },
    
    // Entrepreneurship Bootcamp - Workshop (SOLD_OUT)
    { eventIdx: 42, priceCents: 3000, faceValueCents: 3500, title: "Entrepreneur Bootcamp - 3 Day Pass", row: "BOOT", seat: "E1", image: getImageForEventType('workshop') },
    { eventIdx: 42, priceCents: 1800, faceValueCents: 2200, title: "Entrepreneur Bootcamp - Day 1 Access", row: "BOOT", seat: "D1", image: getImageForEventType('workshop') },
    { eventIdx: 42, priceCents: 4000, faceValueCents: 4000, title: "Entrepreneur Bootcamp - VIP Mentor", row: "VIP", seat: "MENTOR", image: getImageForEventType('workshop') },
  ];

  // Clear existing tickets and create new ones
  await prisma.ticket.deleteMany({});

  for (let i = 0; i < ticketData.length; i++) {
    const t = ticketData[i];
    const seller = sellers[i % sellers.length];
    
    try {
      await prisma.ticket.create({
        data: {
          title: t.title,
          priceCents: t.priceCents,
          faceValueCents: t.faceValueCents,
          image: t.image,
          venue: createdEvents[t.eventIdx].venue,
          row: t.row,
          seat: t.seat,
          date: createdEvents[t.eventIdx].date,
          status: TicketStatus.AVAILABLE,
          sellerId: seller.id,
          eventId: createdEvents[t.eventIdx].id,
        },
      });
    } catch (e) {
      console.log(`Ticket ${t.title} creation skipped or failed:`, (e as Error).message);
    }
  }

  console.log(`Created ${ticketData.length} tickets across ${createdEvents.length} events`);
  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
