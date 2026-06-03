export type CatalogSuggestionType = "ARTIST" | "TEAM" | "VENUE" | "CITY";

export type CatalogSuggestion = {
  type: CatalogSuggestionType;
  value: string;
  label: string;
  subtitle?: string;
  address?: string;
  city?: string;
  region?: string;
  country?: string;
  aliases?: string[];
};

type VenueSeed = {
  name: string;
  address: string;
  city: string;
  region: string;
  country: string;
  aliases?: string[];
};

type TeamSeed = {
  name: string;
  league: string;
  city: string;
  region: string;
  country: string;
  aliases?: string[];
};

type CitySeed = {
  name: string;
  region: string;
  country: string;
  aliases?: string[];
};

const ARTISTS = [
  "21 Savage",
  "Adele",
  "Alicia Keys",
  "Bad Bunny",
  "Billie Eilish",
  "blink-182",
  "Burna Boy",
  "Celine Dion",
  "Charli XCX",
  "Chris Brown",
  "Coldplay",
  "Doja Cat",
  "Drake",
  "Dua Lipa",
  "Ed Sheeran",
  "Foo Fighters",
  "Future",
  "Gracie Abrams",
  "Harry Styles",
  "Hozier",
  "Imagine Dragons",
  "Janet Jackson",
  "Jelly Roll",
  "Jonas Brothers",
  "Karol G",
  "Kendrick Lamar",
  "Kesha",
  "Lady Gaga",
  "Luke Combs",
  "Metallica",
  "Morgan Wallen",
  "Nicki Minaj",
  "Noah Kahan",
  "Olivia Rodrigo",
  "Post Malone",
  "Rauw Alejandro",
  "Sabrina Carpenter",
  "Shawn Mendes",
  "SZA",
  "Tate McRae",
  "Taylor Swift",
  "The Weeknd",
  "Travis Scott",
  "Tyler, The Creator",
  "Usher",
  "Zach Bryan",
].map((name) => ({
  type: "ARTIST" as const,
  value: name,
  label: name,
}));

const TEAMS: TeamSeed[] = [
  { name: "Anaheim Ducks", league: "NHL", city: "Anaheim", region: "CA", country: "USA" },
  { name: "Arizona Cardinals", league: "NFL", city: "Glendale", region: "AZ", country: "USA" },
  { name: "Atlanta Braves", league: "MLB", city: "Atlanta", region: "GA", country: "USA" },
  { name: "Atlanta Falcons", league: "NFL", city: "Atlanta", region: "GA", country: "USA" },
  { name: "Atlanta Hawks", league: "NBA", city: "Atlanta", region: "GA", country: "USA" },
  { name: "Boston Bruins", league: "NHL", city: "Boston", region: "MA", country: "USA" },
  { name: "Boston Celtics", league: "NBA", city: "Boston", region: "MA", country: "USA" },
  { name: "Boston Red Sox", league: "MLB", city: "Boston", region: "MA", country: "USA" },
  { name: "Buffalo Bills", league: "NFL", city: "Orchard Park", region: "NY", country: "USA" },
  { name: "Buffalo Sabres", league: "NHL", city: "Buffalo", region: "NY", country: "USA" },
  { name: "Calgary Flames", league: "NHL", city: "Calgary", region: "AB", country: "Canada" },
  { name: "Carolina Hurricanes", league: "NHL", city: "Raleigh", region: "NC", country: "USA" },
  { name: "Chicago Blackhawks", league: "NHL", city: "Chicago", region: "IL", country: "USA" },
  { name: "Chicago Bulls", league: "NBA", city: "Chicago", region: "IL", country: "USA" },
  { name: "Chicago Cubs", league: "MLB", city: "Chicago", region: "IL", country: "USA" },
  { name: "Chicago White Sox", league: "MLB", city: "Chicago", region: "IL", country: "USA" },
  { name: "Cleveland Browns", league: "NFL", city: "Cleveland", region: "OH", country: "USA" },
  { name: "Cleveland Cavaliers", league: "NBA", city: "Cleveland", region: "OH", country: "USA" },
  { name: "Cleveland Guardians", league: "MLB", city: "Cleveland", region: "OH", country: "USA" },
  { name: "Dallas Cowboys", league: "NFL", city: "Arlington", region: "TX", country: "USA" },
  { name: "Dallas Mavericks", league: "NBA", city: "Dallas", region: "TX", country: "USA" },
  { name: "Dallas Stars", league: "NHL", city: "Dallas", region: "TX", country: "USA" },
  { name: "Denver Broncos", league: "NFL", city: "Denver", region: "CO", country: "USA" },
  { name: "Detroit Lions", league: "NFL", city: "Detroit", region: "MI", country: "USA" },
  { name: "Detroit Red Wings", league: "NHL", city: "Detroit", region: "MI", country: "USA" },
  { name: "Detroit Tigers", league: "MLB", city: "Detroit", region: "MI", country: "USA" },
  { name: "Edmonton Oilers", league: "NHL", city: "Edmonton", region: "AB", country: "Canada" },
  { name: "Golden State Warriors", league: "NBA", city: "San Francisco", region: "CA", country: "USA" },
  { name: "Green Bay Packers", league: "NFL", city: "Green Bay", region: "WI", country: "USA" },
  { name: "Hamilton Tiger-Cats", league: "CFL", city: "Hamilton", region: "ON", country: "Canada", aliases: ["Ti-Cats"] },
  { name: "Inter Miami CF", league: "MLS", city: "Fort Lauderdale", region: "FL", country: "USA", aliases: ["Inter Miami"] },
  { name: "Kansas City Chiefs", league: "NFL", city: "Kansas City", region: "MO", country: "USA" },
  { name: "LA Galaxy", league: "MLS", city: "Carson", region: "CA", country: "USA" },
  { name: "Los Angeles Dodgers", league: "MLB", city: "Los Angeles", region: "CA", country: "USA" },
  { name: "Los Angeles Kings", league: "NHL", city: "Los Angeles", region: "CA", country: "USA" },
  { name: "Los Angeles Lakers", league: "NBA", city: "Los Angeles", region: "CA", country: "USA" },
  { name: "Miami Dolphins", league: "NFL", city: "Miami Gardens", region: "FL", country: "USA" },
  { name: "Miami Heat", league: "NBA", city: "Miami", region: "FL", country: "USA" },
  { name: "Minnesota Vikings", league: "NFL", city: "Minneapolis", region: "MN", country: "USA" },
  { name: "Montreal Canadiens", league: "NHL", city: "Montreal", region: "QC", country: "Canada", aliases: ["Habs"] },
  { name: "Montreal CF", league: "MLS", city: "Montreal", region: "QC", country: "Canada", aliases: ["CF Montreal"] },
  { name: "Montreal Alouettes", league: "CFL", city: "Montreal", region: "QC", country: "Canada" },
  { name: "New England Patriots", league: "NFL", city: "Foxborough", region: "MA", country: "USA" },
  { name: "New York Giants", league: "NFL", city: "East Rutherford", region: "NJ", country: "USA" },
  { name: "New York Islanders", league: "NHL", city: "Elmont", region: "NY", country: "USA" },
  { name: "New York Jets", league: "NFL", city: "East Rutherford", region: "NJ", country: "USA" },
  { name: "New York Knicks", league: "NBA", city: "New York", region: "NY", country: "USA" },
  { name: "New York Mets", league: "MLB", city: "New York", region: "NY", country: "USA" },
  { name: "New York Rangers", league: "NHL", city: "New York", region: "NY", country: "USA" },
  { name: "New York Yankees", league: "MLB", city: "New York", region: "NY", country: "USA" },
  { name: "Ottawa Senators", league: "NHL", city: "Ottawa", region: "ON", country: "Canada" },
  { name: "Philadelphia 76ers", league: "NBA", city: "Philadelphia", region: "PA", country: "USA" },
  { name: "Philadelphia Eagles", league: "NFL", city: "Philadelphia", region: "PA", country: "USA" },
  { name: "Philadelphia Flyers", league: "NHL", city: "Philadelphia", region: "PA", country: "USA" },
  { name: "Pittsburgh Penguins", league: "NHL", city: "Pittsburgh", region: "PA", country: "USA" },
  { name: "San Francisco 49ers", league: "NFL", city: "Santa Clara", region: "CA", country: "USA" },
  { name: "Seattle Kraken", league: "NHL", city: "Seattle", region: "WA", country: "USA" },
  { name: "Seattle Seahawks", league: "NFL", city: "Seattle", region: "WA", country: "USA" },
  { name: "Tampa Bay Lightning", league: "NHL", city: "Tampa", region: "FL", country: "USA" },
  { name: "Toronto Argonauts", league: "CFL", city: "Toronto", region: "ON", country: "Canada", aliases: ["Argos"] },
  { name: "Toronto Blue Jays", league: "MLB", city: "Toronto", region: "ON", country: "Canada", aliases: ["Blue Jays", "Jays"] },
  { name: "Toronto FC", league: "MLS", city: "Toronto", region: "ON", country: "Canada", aliases: ["TFC"] },
  { name: "Toronto Maple Leafs", league: "NHL", city: "Toronto", region: "ON", country: "Canada", aliases: ["Leafs"] },
  { name: "Toronto Raptors", league: "NBA", city: "Toronto", region: "ON", country: "Canada", aliases: ["Raptors"] },
  { name: "Vancouver Canucks", league: "NHL", city: "Vancouver", region: "BC", country: "Canada" },
  { name: "Vancouver Whitecaps FC", league: "MLS", city: "Vancouver", region: "BC", country: "Canada", aliases: ["Whitecaps"] },
  { name: "Vegas Golden Knights", league: "NHL", city: "Las Vegas", region: "NV", country: "USA" },
  { name: "Washington Capitals", league: "NHL", city: "Washington", region: "DC", country: "USA" },
  { name: "Winnipeg Blue Bombers", league: "CFL", city: "Winnipeg", region: "MB", country: "Canada" },
  { name: "Winnipeg Jets", league: "NHL", city: "Winnipeg", region: "MB", country: "Canada" },
];

const VENUES: VenueSeed[] = [
  { name: "Scotiabank Arena", address: "40 Bay St", city: "Toronto", region: "ON", country: "Canada", aliases: ["Air Canada Centre"] },
  { name: "Rogers Centre", address: "1 Blue Jays Way", city: "Toronto", region: "ON", country: "Canada", aliases: ["SkyDome"] },
  { name: "BMO Field", address: "170 Princes' Blvd", city: "Toronto", region: "ON", country: "Canada" },
  { name: "Budweiser Stage", address: "909 Lake Shore Blvd W", city: "Toronto", region: "ON", country: "Canada" },
  { name: "Massey Hall", address: "178 Victoria St", city: "Toronto", region: "ON", country: "Canada" },
  { name: "History", address: "1663 Queen St E", city: "Toronto", region: "ON", country: "Canada" },
  { name: "Coca-Cola Coliseum", address: "45 Manitoba Dr", city: "Toronto", region: "ON", country: "Canada" },
  { name: "Meridian Hall", address: "1 Front St E", city: "Toronto", region: "ON", country: "Canada", aliases: ["Sony Centre"] },
  { name: "Princess of Wales Theatre", address: "300 King St W", city: "Toronto", region: "ON", country: "Canada" },
  { name: "Royal Alexandra Theatre", address: "260 King St W", city: "Toronto", region: "ON", country: "Canada" },
  { name: "Ed Mirvish Theatre", address: "244 Victoria St", city: "Toronto", region: "ON", country: "Canada" },
  { name: "Four Seasons Centre", address: "145 Queen St W", city: "Toronto", region: "ON", country: "Canada" },
  { name: "Roy Thomson Hall", address: "60 Simcoe St", city: "Toronto", region: "ON", country: "Canada" },
  { name: "Meridian Arts Centre", address: "5040 Yonge St", city: "Toronto", region: "ON", country: "Canada" },
  { name: "TD Coliseum", address: "101 York Blvd", city: "Hamilton", region: "ON", country: "Canada", aliases: ["FirstOntario Centre"] },
  { name: "Tim Hortons Field", address: "64 Melrose Ave N", city: "Hamilton", region: "ON", country: "Canada" },
  { name: "Canadian Tire Centre", address: "1000 Palladium Dr", city: "Ottawa", region: "ON", country: "Canada" },
  { name: "TD Place Arena", address: "1015 Bank St", city: "Ottawa", region: "ON", country: "Canada" },
  { name: "Bell Centre", address: "1909 Av. des Canadiens-de-Montreal", city: "Montreal", region: "QC", country: "Canada" },
  { name: "MTELUS", address: "59 Rue Sainte-Catherine E", city: "Montreal", region: "QC", country: "Canada" },
  { name: "Olympic Stadium", address: "4545 Av. Pierre-De Coubertin", city: "Montreal", region: "QC", country: "Canada" },
  { name: "Videotron Centre", address: "250 Wilfrid-Hamel Blvd", city: "Quebec City", region: "QC", country: "Canada" },
  { name: "Rogers Arena", address: "800 Griffiths Way", city: "Vancouver", region: "BC", country: "Canada" },
  { name: "BC Place", address: "777 Pacific Blvd", city: "Vancouver", region: "BC", country: "Canada" },
  { name: "Commodore Ballroom", address: "868 Granville St", city: "Vancouver", region: "BC", country: "Canada" },
  { name: "Rogers Place", address: "10220 104 Ave NW", city: "Edmonton", region: "AB", country: "Canada" },
  { name: "Commonwealth Stadium", address: "11000 Stadium Rd NW", city: "Edmonton", region: "AB", country: "Canada" },
  { name: "Scotiabank Saddledome", address: "555 Saddledome Rise SE", city: "Calgary", region: "AB", country: "Canada" },
  { name: "Canada Life Centre", address: "300 Portage Ave", city: "Winnipeg", region: "MB", country: "Canada" },
  { name: "Princess Auto Stadium", address: "315 Chancellor Matheson Rd", city: "Winnipeg", region: "MB", country: "Canada", aliases: ["IG Field"] },
  { name: "Madison Square Garden", address: "4 Pennsylvania Plaza", city: "New York", region: "NY", country: "USA" },
  { name: "Barclays Center", address: "620 Atlantic Ave", city: "Brooklyn", region: "NY", country: "USA" },
  { name: "MetLife Stadium", address: "1 MetLife Stadium Dr", city: "East Rutherford", region: "NJ", country: "USA" },
  { name: "Yankee Stadium", address: "1 E 161 St", city: "Bronx", region: "NY", country: "USA" },
  { name: "Citi Field", address: "41 Seaver Way", city: "Queens", region: "NY", country: "USA" },
  { name: "TD Garden", address: "100 Legends Way", city: "Boston", region: "MA", country: "USA" },
  { name: "Fenway Park", address: "4 Jersey St", city: "Boston", region: "MA", country: "USA" },
  { name: "Wells Fargo Center", address: "3601 S Broad St", city: "Philadelphia", region: "PA", country: "USA" },
  { name: "Lincoln Financial Field", address: "1 Lincoln Financial Field Way", city: "Philadelphia", region: "PA", country: "USA" },
  { name: "United Center", address: "1901 W Madison St", city: "Chicago", region: "IL", country: "USA" },
  { name: "Wrigley Field", address: "1060 W Addison St", city: "Chicago", region: "IL", country: "USA" },
  { name: "Crypto.com Arena", address: "1111 S Figueroa St", city: "Los Angeles", region: "CA", country: "USA", aliases: ["Staples Center"] },
  { name: "SoFi Stadium", address: "1001 Stadium Dr", city: "Inglewood", region: "CA", country: "USA" },
  { name: "Dodger Stadium", address: "1000 Vin Scully Ave", city: "Los Angeles", region: "CA", country: "USA" },
  { name: "Hollywood Bowl", address: "2301 Highland Ave", city: "Los Angeles", region: "CA", country: "USA" },
  { name: "Chase Center", address: "1 Warriors Way", city: "San Francisco", region: "CA", country: "USA" },
  { name: "Levi's Stadium", address: "4900 Marie P DeBartolo Way", city: "Santa Clara", region: "CA", country: "USA" },
  { name: "T-Mobile Arena", address: "3780 Las Vegas Blvd S", city: "Las Vegas", region: "NV", country: "USA" },
  { name: "Allegiant Stadium", address: "3333 Al Davis Way", city: "Las Vegas", region: "NV", country: "USA" },
  { name: "American Airlines Center", address: "2500 Victory Ave", city: "Dallas", region: "TX", country: "USA" },
  { name: "AT&T Stadium", address: "1 AT&T Way", city: "Arlington", region: "TX", country: "USA" },
  { name: "Kaseya Center", address: "601 Biscayne Blvd", city: "Miami", region: "FL", country: "USA" },
  { name: "Hard Rock Stadium", address: "347 Don Shula Dr", city: "Miami Gardens", region: "FL", country: "USA" },
  { name: "Amalie Arena", address: "401 Channelside Dr", city: "Tampa", region: "FL", country: "USA" },
  { name: "State Farm Arena", address: "1 State Farm Dr", city: "Atlanta", region: "GA", country: "USA" },
  { name: "Mercedes-Benz Stadium", address: "1 AMB Dr NW", city: "Atlanta", region: "GA", country: "USA" },
  { name: "Ball Arena", address: "1000 Chopper Cir", city: "Denver", region: "CO", country: "USA" },
  { name: "Lumen Field", address: "800 Occidental Ave S", city: "Seattle", region: "WA", country: "USA" },
  { name: "Climate Pledge Arena", address: "334 1st Ave N", city: "Seattle", region: "WA", country: "USA" },
];

const CITIES: CitySeed[] = [
  { name: "Toronto", region: "ON", country: "Canada", aliases: ["GTA"] },
  { name: "Hamilton", region: "ON", country: "Canada" },
  { name: "Ottawa", region: "ON", country: "Canada" },
  { name: "Montreal", region: "QC", country: "Canada" },
  { name: "Quebec City", region: "QC", country: "Canada" },
  { name: "Vancouver", region: "BC", country: "Canada" },
  { name: "Victoria", region: "BC", country: "Canada" },
  { name: "Calgary", region: "AB", country: "Canada" },
  { name: "Edmonton", region: "AB", country: "Canada" },
  { name: "Winnipeg", region: "MB", country: "Canada" },
  { name: "Saskatoon", region: "SK", country: "Canada" },
  { name: "Regina", region: "SK", country: "Canada" },
  { name: "Halifax", region: "NS", country: "Canada" },
  { name: "New York", region: "NY", country: "USA" },
  { name: "Brooklyn", region: "NY", country: "USA" },
  { name: "Boston", region: "MA", country: "USA" },
  { name: "Philadelphia", region: "PA", country: "USA" },
  { name: "Chicago", region: "IL", country: "USA" },
  { name: "Los Angeles", region: "CA", country: "USA" },
  { name: "San Francisco", region: "CA", country: "USA" },
  { name: "Las Vegas", region: "NV", country: "USA" },
  { name: "Dallas", region: "TX", country: "USA" },
  { name: "Miami", region: "FL", country: "USA" },
  { name: "Atlanta", region: "GA", country: "USA" },
  { name: "Denver", region: "CO", country: "USA" },
  { name: "Seattle", region: "WA", country: "USA" },
  { name: "Nashville", region: "TN", country: "USA" },
  { name: "Austin", region: "TX", country: "USA" },
  { name: "Detroit", region: "MI", country: "USA" },
  { name: "Buffalo", region: "NY", country: "USA" },
  { name: "Cleveland", region: "OH", country: "USA" },
  { name: "Pittsburgh", region: "PA", country: "USA" },
  { name: "Washington", region: "DC", country: "USA" },
  { name: "Minneapolis", region: "MN", country: "USA" },
  { name: "Kansas City", region: "MO", country: "USA" },
  { name: "Tampa", region: "FL", country: "USA" },
];

export const LIVE_EVENT_CATALOG: CatalogSuggestion[] = [
  ...ARTISTS,
  ...TEAMS.map((team) => ({
    type: "TEAM" as const,
    value: team.name,
    label: team.name,
    subtitle: `${team.league} · ${team.city}, ${team.region}`,
    city: team.city,
    region: team.region,
    country: team.country,
    aliases: team.aliases,
  })),
  ...VENUES.map((venue) => ({
    type: "VENUE" as const,
    value: venue.name,
    label: venue.name,
    subtitle: `${venue.address}, ${venue.city}, ${venue.region}`,
    address: venue.address,
    city: venue.city,
    region: venue.region,
    country: venue.country,
    aliases: venue.aliases,
  })),
  ...CITIES.map((city) => ({
    type: "CITY" as const,
    value: city.name,
    label: city.name,
    subtitle: `${city.region}, ${city.country}`,
    city: city.name,
    region: city.region,
    country: city.country,
    aliases: city.aliases,
  })),
];

function searchableText(item: CatalogSuggestion) {
  return [
    item.label,
    item.value,
    item.subtitle,
    item.address,
    item.city,
    item.region,
    item.country,
    ...(item.aliases ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreItem(item: CatalogSuggestion, query: string) {
  const q = query.toLowerCase();
  const label = item.label.toLowerCase();
  const aliases = (item.aliases ?? []).map((alias) => alias.toLowerCase());
  if (label === q || aliases.includes(q)) return 1000;
  if (label.startsWith(q) || aliases.some((alias) => alias.startsWith(q))) return 800;
  if (label.includes(q) || aliases.some((alias) => alias.includes(q))) return 600;
  if (searchableText(item).includes(q)) return 300;
  return 0;
}

export function searchCatalogSuggestions({
  query,
  type,
  limit = 12,
}: {
  query?: string;
  type?: CatalogSuggestionType | "ALL";
  limit?: number;
}) {
  const q = (query ?? "").trim();
  const max = Math.min(Math.max(limit, 1), 50);
  const source = type && type !== "ALL"
    ? LIVE_EVENT_CATALOG.filter((item) => item.type === type)
    : LIVE_EVENT_CATALOG;

  if (!q) return source.slice(0, max);

  return source
    .map((item) => ({ item, score: scoreItem(item, q) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
    .slice(0, max)
    .map(({ item }) => item);
}
