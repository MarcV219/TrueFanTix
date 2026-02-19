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

// Sites that typically block hotlinking or require authentication
const BLOCKED_DOMAINS = [
  'gettyimages.com',
  'gettyimages.ca',
  'istockphoto.com',
  'shutterstock.com',
  'alamy.com',
  'dreamstime.com',
  'depositphotos.com',
  '123rf.com',
  'bigstockphoto.com',
  'canstockphoto.com',
  'agefotostock.com',
  'pond5.com',
  'clipartof.com',
  'vecteezy.com',
  'freepik.com',
  'adobe.com/stock',
  'facebook.com',
  'fbcdn.net',
  'instagram.com',
  'cdninstagram.com',
];

// Sites that generally work well for hotlinking
const RELIABLE_DOMAINS = [
  'wikipedia.org',
  'wikimedia.org',
  'upload.wikimedia.org',
  'amazon.com',
  'm.media-amazon.com',
  'imdb.com',
  'espn.com',
  'nba.com',
  'nhl.com',
  'mlb.com',
  'nfl.com',
  'fifa.com',
  'last.fm',
  'ticketmaster.com',
  'stubhub.com',
  'eventbrite.com',
  'songkick.com',
  'bandsintown.com',
  'spotify.com',
  'soundcloud.com',
  'youtube.com',
  'ytimg.com',
  'vimeo.com',
  'dailymotion.com',
  'reddit.com',
  'redd.it',
  'imgur.com',
  'i.imgur.com',
  'cloudfront.net',
  'akamaized.net',
  'pinimg.com',
  'twimg.com',
  'wikia.com',
  'fandom.com',
  'static.wikia.nocookie.net',
  ' billboard.com',
  'rollingstone.com',
  'pitchfork.com',
  'consequenceofsound.net',
  'stereogum.com',
  'nme.com',
  'kerrang.com',
  'mtv.com',
  'vh1.com',
  'bet.com',
  'complex.com',
  'hotnewhiphop.com',
  'xxlmag.com',
  'thefader.com',
  'pigeonsandplanes.com',
  'genius.com',
  'lyrics.com',
  'allmusic.com',
  'discogs.com',
  'musicbrainz.org',
];

/**
 * Get image search query based on ticket title and event type
 */
function getImageSearchQuery(title: string, eventType: string): string {
  const lower = title.toLowerCase();
  
  // Extract main artist/performer name from title
  // Remove common suffixes like "- Upper Level", "vs Lakers", etc.
  let mainName = title;
  
  // Remove ticket tier info
  mainName = mainName.replace(/\s*-\s*(Upper|Lower|Floor|VIP|Club|Mezzanine|Balcony|Orchestra).*/i, '');
  mainName = mainName.replace(/\s*-\s*\d+\s*(Level|Row|Seat).*/i, '');
  mainName = mainName.replace(/\s*vs\s+.*/i, '');
  
  // Specific artists - use simpler queries that work better
  if (lower.includes('taylor swift')) return 'Taylor Swift';
  if (lower.includes('drake')) return 'Drake musician';
  if (lower.includes('ed sheeran')) return 'Ed Sheeran';
  if (lower.includes('weeknd')) return 'The Weeknd';
  if (lower.includes('adele')) return 'Adele';
  if (lower.includes('beyoncé') || lower.includes('beyonce')) return 'Beyoncé';
  
  // Sports teams
  if (lower.includes('raptors')) return 'Toronto Raptors';
  if (lower.includes('leafs')) return 'Toronto Maple Leafs';
  if (lower.includes('blue jays')) return 'Toronto Blue Jays';
  if (lower.includes('argonauts') || lower.includes('argos')) return 'Toronto Argonauts';
  if (lower.includes('tfc') || lower.includes('toronto fc')) return 'Toronto FC';
  
  // Theatre shows
  if (lower.includes('hamilton')) return 'Hamilton musical';
  if (lower.includes('lion king')) return 'Lion King musical';
  if (lower.includes('wicked')) return 'Wicked musical';
  if (lower.includes('mamma mia')) return 'Mamma Mia musical';
  
  // Comedy
  if (lower.includes('dave chappelle')) return 'Dave Chappelle';
  if (lower.includes('kevin hart')) return 'Kevin Hart';
  if (lower.includes('john mulaney')) return 'John Mulaney';
  if (lower.includes('ali wong')) return 'Ali Wong';
  if (lower.includes('jim gaffigan')) return 'Jim Gaffigan';
  
  // Opera
  if (lower.includes('la bohème') || lower.includes('boheme')) return 'La Bohème opera';
  if (lower.includes('magic flute')) return 'Magic Flute opera';
  if (lower.includes('carmen')) return 'Carmen opera';
  
  // Generic based on event type
  if (eventType.includes('basketball')) return 'basketball';
  if (eventType.includes('hockey')) return 'hockey';
  if (eventType.includes('baseball')) return 'baseball';
  if (eventType.includes('football')) return 'football';
  if (eventType.includes('soccer')) return 'soccer';
  if (eventType.includes('concert')) return 'concert';
  if (eventType.includes('theatre')) return 'theatre';
  if (eventType.includes('comedy')) return 'comedy';
  
  return mainName.trim();
}

/**
 * Check if URL is from a blocked domain
 */
function isBlockedUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return BLOCKED_DOMAINS.some(domain => lowerUrl.includes(domain));
}

/**
 * Check if URL is from a reliable domain
 */
function isReliableUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return RELIABLE_DOMAINS.some(domain => lowerUrl.includes(domain));
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
      `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=20`,
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
    
    // Filter and score image URLs
    const scored = results
      .map((r: any) => {
        const url = r.properties?.url || r.thumbnail?.src || '';
        const lowerUrl = url.toLowerCase();
        
        // Skip blocked domains
        if (isBlockedUrl(url)) return null;
        
        // Skip paparazzi/gossip sites
        const skipDomains = ['perez', 'tmz', 'justjared', 'popsugar', 'gossip', 'paparazzi'];
        if (skipDomains.some(d => lowerUrl.includes(d))) return null;
        
        // Score the URL
        let score = 0;
        if (isReliableUrl(url)) score += 10;
        if (url.includes('wikipedia.org') || url.includes('wikimedia.org')) score += 5;
        if (url.includes('amazon.com') || url.includes('imdb.com')) score += 3;
        
        // Prefer HTTPS
        if (url.startsWith('https://')) score += 1;
        
        return { url, score };
      })
      .filter((item: any) => item !== null && item.url && item.url.startsWith('http'))
      .sort((a: any, b: any) => b.score - a.score);
    
    return scored.map((item: any) => item.url);
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
    // Use first (highest scored) result and cache it
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

/**
 * Validate if an image URL is likely to work (not blocked)
 */
export async function validateImageUrl(url: string): Promise<boolean> {
  if (!url || url.startsWith('/')) return true; // Local images always work
  
  // Skip validation for known blocked domains
  if (isBlockedUrl(url)) return false;
  
  return true;
}
