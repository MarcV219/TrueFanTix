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

/**
 * Get image search query based on ticket title and event type
 * Uses more specific terms to avoid paparazzi/old photos
 */
function getImageSearchQuery(title: string, eventType: string): string {
  const lower = title.toLowerCase();
  
  // Specific artists/performers with better search terms
  if (lower.includes('taylor swift')) return 'Taylor Swift official promo photo';
  if (lower.includes('drake')) return 'Drake artist official photo';
  if (lower.includes('ed sheeran')) return 'Ed Sheeran official press photo';
  if (lower.includes('weeknd')) return 'The Weeknd official artist photo';
  if (lower.includes('adele')) return 'Adele singer official photo';
  if (lower.includes('beyoncé') || lower.includes('beyonce')) return 'Beyoncé official photo';
  
  // Sports teams - official logos/current
  if (lower.includes('raptors')) return 'Toronto Raptors logo';
  if (lower.includes('leafs')) return 'Toronto Maple Leafs logo';
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
    // Prioritize certain domains for quality
    const priorityDomains = ['wikipedia.org', 'wikimedia.org', 'espn.com', 'nba.com', 'nhl.com', 'mlb.com'];
    
    const filtered = results
      .filter((r: any) => {
        const url = (r.properties?.url || r.thumbnail?.src || '').toLowerCase();
        // Skip paparazzi sites, fan sites with poor quality
        const skipDomains = ['perez', 'tmz', 'justjared', 'popsugar', 'gossip', 'paparazzi'];
        return !skipDomains.some(d => url.includes(d));
      })
      .map((r: any) => ({
        url: r.properties?.url || r.thumbnail?.src,
        priority: priorityDomains.some(d => (r.properties?.url || '').includes(d)) ? 1 : 0
      }))
      .filter((item: any) => item.url && item.url.startsWith('http'))
      .sort((a: any, b: any) => b.priority - a.priority);
    
    return filtered.map((item: any) => item.url);
  } catch (error) {
    console.error('Image search error:', error);
    return [];
  }
}

/**
 * Get image for a ticket
 */
export async function getTicketImage(
  ticketTitle: string,
  eventType: string
): Promise<string> {
  const cacheKey = `${ticketTitle}-${eventType}`;
  
  // Check cache
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey)!;
  }
  
  // Search for image
  const query = getImageSearchQuery(ticketTitle, eventType);
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
 * Get placeholder image for event type
 */
export function getPlaceholderImage(eventType: string): string {
  return PLACEHOLDER_IMAGES[eventType] || '/default.jpg';
}
