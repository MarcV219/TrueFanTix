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

// Cache for fetched images (in-memory, could be persisted to DB)
const imageCache = new Map<string, string>();

/**
 * Get image search query based on ticket title and event type
 */
function getImageSearchQuery(title: string, eventType: string): string {
  const lower = title.toLowerCase();
  
  // Extract artist/performer/team name
  if (lower.includes('taylor swift')) return 'Taylor Swift concert performance';
  if (lower.includes('drake')) return 'Drake rapper concert';
  if (lower.includes('ed sheeran')) return 'Ed Sheeran singer';
  if (lower.includes('weeknd')) return 'The Weeknd artist';
  if (lower.includes('adele')) return 'Adele singer';
  if (lower.includes('beyoncé') || lower.includes('beyonce')) return 'Beyoncé performer';
  
  // Sports teams
  if (lower.includes('raptors')) return 'Toronto Raptors NBA basketball';
  if (lower.includes('leafs')) return 'Toronto Maple Leafs NHL hockey';
  if (lower.includes('blue jays')) return 'Toronto Blue Jays MLB baseball';
  if (lower.includes('argonauts') || lower.includes('argos')) return 'Toronto Argonauts CFL football';
  if (lower.includes('tfc') || lower.includes('toronto fc')) return 'Toronto FC soccer';
  
  // Theatre shows
  if (lower.includes('hamilton')) return 'Hamilton musical Broadway';
  if (lower.includes('lion king')) return 'Lion King musical';
  if (lower.includes('wicked')) return 'Wicked musical Broadway';
  if (lower.includes('mamma mia')) return 'Mamma Mia musical';
  
  // Comedy
  if (lower.includes('dave chappelle')) return 'Dave Chappelle comedian';
  if (lower.includes('kevin hart')) return 'Kevin Hart comedian';
  if (lower.includes('john mulaney')) return 'John Mulaney comedian';
  if (lower.includes('ali wong')) return 'Ali Wong comedian';
  if (lower.includes('jim gaffigan')) return 'Jim Gaffigan comedian';
  
  // Opera
  if (lower.includes('la bohème') || lower.includes('boheme')) return 'La Bohème opera';
  if (lower.includes('magic flute')) return 'Magic Flute opera';
  if (lower.includes('carmen')) return 'Carmen opera';
  
  // Generic based on event type
  if (eventType.includes('basketball')) return 'basketball game arena';
  if (eventType.includes('hockey')) return 'hockey game ice rink';
  if (eventType.includes('baseball')) return 'baseball game stadium';
  if (eventType.includes('football')) return 'football game stadium';
  if (eventType.includes('soccer')) return 'soccer football match';
  if (eventType.includes('concert')) return 'concert live music performance';
  if (eventType.includes('theatre')) return 'theatre stage performance';
  if (eventType.includes('comedy')) return 'comedy stand up show';
  
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
      `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=5`,
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
    
    // Return image URLs
    return results
      .map((r: any) => r.properties?.url || r.thumbnail?.src)
      .filter((url: string) => url && url.startsWith('http'));
  } catch (error) {
    console.error('Image search error:', error);
    return [];
  }
}

/**
 * Get image for a ticket
 * First checks cache, then searches web, falls back to placeholder
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
