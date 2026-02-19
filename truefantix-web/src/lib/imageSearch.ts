// Image fetching utility for TrueFanTix tickets
// Uses Brave Image Search API to find images for artists, teams, shows

const PLACEHOLDER_IMAGES: Record<string, string> = {
  'sports-basketball': '/basketball-placeholder.jpg',
  'sports-football': '/football-placeholder.jpg',
  'sports-hockey': '/hockey-placeholder.jpg',
  'sports-soccer': '/sports-placeholder.jpg',
  'sports-lacrosse': '/sports-placeholder.jpg',
  'sports-baseball': '/sports-placeholder.jpg',
  'sports-other': '/sports-placeholder.jpg',
  'concert': '/concert-placeholder.jpg',
  'comedy': '/comedy-placeholder.jpg',
  'conference': '/conference-placeholder.jpg',
  'festival': '/festival-placeholder.jpg',
  'gala': '/gala-placeholder.jpg',
  'opera': '/opera-placeholder.jpg',
  'theatre': '/theatre-placeholder.jpg',
  'workshop': '/workshop-placeholder.jpg',
  'other': '/default.jpg',
};

// Cache for fetched images
const imageCache = new Map<string, string>();

// Known good images for popular artists/teams - curated list
const CURATED_IMAGES: Record<string, string> = {
  // Concerts - using official promo photos
  'taylor swift': 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/191125_Taylor_Swift_at_the_2019_American_Music_Awards.png/640px-191125_Taylor_Swift_at_the_2019_American_Music_Awards.png',
  'drake': 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Drake_MTV_VMAs_2023.jpg/640px-Drake_MTV_VMAs_2023.jpg',
  'ed sheeran': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Ed_Sheeran_2023.jpg/640px-Ed_Sheeran_2023.jpg',
  'weeknd': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/The_Weeknd_2023.jpg/640px-The_Weeknd_2023.jpg',
  'adele': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Adele_2016.jpg/640px-Adele_2016.jpg',
  'beyonce': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Beyonc%C3%A9_at_The_Lion_King_European_Premiere_2019.png/640px-Beyonc%C3%A9_at_The_Lion_King_European_Premiere_2019.png',
  
  // Sports teams - using official logos/team photos
  'raptors': 'https://upload.wikimedia.org/wikipedia/en/thumb/3/36/Toronto_Raptors_logo.svg/640px-Toronto_Raptors_logo.svg.png',
  'leafs': 'https://upload.wikimedia.org/wikipedia/en/thumb/b/b6/Toronto_Maple_Leafs_2016_logo.svg/640px-Toronto_Maple_Leafs_2016_logo.svg.png',
  'blue jays': 'https://upload.wikimedia.org/wikipedia/en/thumb/c/cc/Toronto_Blue_Jays_logo_2012.svg/640px-Toronto_Blue_Jays_logo_2012.svg.png',
  'argonauts': 'https://upload.wikimedia.org/wikipedia/en/thumb/8/8e/Toronto_Argonauts_Logo_2021.svg/640px-Toronto_Argonauts_Logo_2021.svg.png',
  'argos': 'https://upload.wikimedia.org/wikipedia/en/thumb/8/8e/Toronto_Argonauts_Logo_2021.svg/640px-Toronto_Argonauts_Logo_2021.svg.png',
  'tfc': 'https://upload.wikimedia.org/wikipedia/en/thumb/7/7d/Toronto_FC_Logo_2017.svg/640px-Toronto_FC_Logo_2017.svg.png',
  
  // Theatre shows
  'hamilton': 'https://upload.wikimedia.org/wikipedia/en/thumb/8/83/Hamilton-poster.jpg/640px-Hamilton-poster.jpg',
  'lion king': 'https://upload.wikimedia.org/wikipedia/en/thumb/0/0d/The_Lion_King_2019_poster.png/640px-The_Lion_King_2019_poster.png',
  'wicked': 'https://upload.wikimedia.org/wikipedia/en/thumb/7/7c/Wicked_Original_Broadway_Poster.jpg/640px-Wicked_Original_Broadway_Poster.jpg',
  'mamma mia': 'https://upload.wikimedia.org/wikipedia/en/thumb/a/a0/Mamma_Mia_The_Movie_Poster.jpg/640px-Mamma_Mia_The_Movie_Poster.jpg',
  
  // Comedy
  'dave chappelle': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/71/Dave_Chappelle_2018.jpg/640px-Dave_Chappelle_2018.jpg',
  'kevin hart': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Kevin_Hart_2014_%28cropped_2%29.jpg/640px-Kevin_Hart_2014_%28cropped_2%29.jpg',
  
  // Opera
  'carmen': 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Carmen_by_Pierre-Auguste_Lam%2C_1895.jpg/640px-Carmen_by_Pierre-Auguste_Lam%2C_1895.jpg',
};

/**
 * Get image search query based on ticket title and event type
 * Uses more specific terms to avoid paparazzi/old photos
 */
function getImageSearchQuery(title: string, eventType: string): string {
  const lower = title.toLowerCase();
  
  // Check curated images first
  for (const [key, url] of Object.entries(CURATED_IMAGES)) {
    if (lower.includes(key)) {
      return `CURATED:${key}`; // Special marker for curated images
    }
  }
  
  // Specific artists/performers with better search terms
  if (lower.includes('taylor swift')) return 'Taylor Swift official promo photo 2024';
  if (lower.includes('drake')) return 'Drake artist official photo';
  if (lower.includes('ed sheeran')) return 'Ed Sheeran official press photo';
  if (lower.includes('weeknd')) return 'The Weeknd official artist photo';
  if (lower.includes('adele')) return 'Adele singer official photo';
  if (lower.includes('beyoncé') || lower.includes('beyonce')) return 'Beyoncé official photo';
  
  // Sports teams - official logos/current
  if (lower.includes('raptors')) return 'Toronto Raptors logo 2024';
  if (lower.includes('leafs')) return 'Toronto Maple Leafs logo 2024';
  if (lower.includes('blue jays')) return 'Toronto Blue Jays logo';
  if (lower.includes('argonauts') || lower.includes('argos')) return 'Toronto Argonauts logo';
  if (lower.includes('tfc') || lower.includes('toronto fc')) return 'Toronto FC logo';
  
  // Theatre shows
  if (lower.includes('hamilton')) return 'Hamilton musical official poster';
  if (lower.includes('lion king')) return 'Lion King musical official';
  if (lower.includes('wicked')) return 'Wicked musical official poster';
  if (lower.includes('mamma mia')) return 'Mamma Mia musical';
  
  // Comedy
  if (lower.includes('dave chappelle')) return 'Dave Chappelle comedian official';
  if (lower.includes('kevin hart')) return 'Kevin Hart comedian official';
  if (lower.includes('john mulaney')) return 'John Mulaney comedian';
  if (lower.includes('ali wong')) return 'Ali Wong comedian';
  if (lower.includes('jim gaffigan')) return 'Jim Gaffigan comedian';
  
  // Opera
  if (lower.includes('la bohème') || lower.includes('boheme')) return 'La Bohème opera';
  if (lower.includes('magic flute')) return 'Magic Flute opera';
  if (lower.includes('carmen')) return 'Carmen opera';
  
  // Generic based on event type with quality filters
  if (eventType.includes('basketball')) return 'basketball game arena sports';
  if (eventType.includes('hockey')) return 'ice hockey game arena NHL';
  if (eventType.includes('baseball')) return 'baseball stadium MLB game';
  if (eventType.includes('football')) return 'football stadium game';
  if (eventType.includes('soccer')) return 'soccer football stadium match';
  if (eventType.includes('concert')) return 'concert stage lights performance';
  if (eventType.includes('theatre')) return 'theatre stage performance curtain';
  if (eventType.includes('comedy')) return 'comedy show stage microphone';
  
  return title;
}

/**
 * Search for images using Brave Search API
 */
async function searchImages(query: string): Promise<string[]> {
  try {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      console.log('No Brave API key configured, using placeholder');
      return [];
    }
    
    const response = await fetch(
      `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=10`,
      {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey,
        },
      }
    );
    
    if (!response.ok) {
      console.log('Brave image search failed:', response.status);
      return [];
    }
    
    const data = await response.json();
    const results = data.results || [];
    
    // Filter and return image URLs
    // Skip likely paparazzi or low-quality images
    return results
      .filter((r: any) => {
        const url = (r.properties?.url || r.thumbnail?.src || '').toLowerCase();
        // Skip paparazzi sites, fan sites with poor quality
        const skipDomains = ['perez', 'tmz', 'justjared', 'popsugar', 'gossip', 'paparazzi'];
        return !skipDomains.some(d => url.includes(d));
      })
      .map((r: any) => r.properties?.url || r.thumbnail?.src)
      .filter((url: string) => url && url.startsWith('http'));
  } catch (error) {
    console.error('Image search error:', error);
    return [];
  }
}

/**
 * Get image for a ticket
 * First checks curated list, then cache, then searches web, falls back to placeholder
 */
export async function getTicketImage(
  ticketTitle: string,
  eventType: string
): Promise<string> {
  const cacheKey = `${ticketTitle}-${eventType}`;
  
  // Check curated images first
  const lower = ticketTitle.toLowerCase();
  for (const [key, url] of Object.entries(CURATED_IMAGES)) {
    if (lower.includes(key)) {
      return url;
    }
  }
  
  // Check cache
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey)!;
  }
  
  // Search for image
  const query = getImageSearchQuery(ticketTitle, eventType);
  
  // If it's a curated marker, we already returned above
  if (query.startsWith('CURATED:')) {
    const key = query.replace('CURATED:', '');
    if (CURATED_IMAGES[key]) {
      return CURATED_IMAGES[key];
    }
  }
  
  const imageUrls = await searchImages(query);
  
  if (imageUrls.length > 0) {
    // Use first result and cache it
    imageCache.set(cacheKey, imageUrls[0]);
    return imageUrls[0];
  }
  
  // Fall back to placeholder
  const placeholder = PLACEHOLDER_IMAGES[eventType] || '/default.jpg';
  imageCache.set(cacheKey, placeholder);
  return placeholder;
}

/**
 * Get placeholder image for event type (used when web search fails or is disabled)
 */
export function getPlaceholderImage(eventType: string): string {
  return PLACEHOLDER_IMAGES[eventType] || '/default.jpg';
}

/**
 * Pre-fetch images for multiple tickets
 */
export async function prefetchTicketImages(
  tickets: Array<{ title: string; eventType: string }>
): Promise<void> {
  const promises = tickets.map(t => getTicketImage(t.title, t.eventType));
  await Promise.all(promises);
}
