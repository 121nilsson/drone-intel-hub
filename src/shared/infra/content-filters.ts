/**
 * Content filters for ingested text.
 * Centralized filters to reduce noise (boilerplate, banners, ads, related content)
 * from web pages, RSS feeds, and other sources before AI extraction.
 */

/** Common noise patterns to remove from extracted text */
export const GENERAL_FILTERS = {
  // Cookie consent banners
  cookieBanners: [
    /Cookie[\s\S]*?(accept|agree|consent|ok|close|dismiss)/gi,
    /This website uses cookies[\s\S]*?\n/gi,
    /We use cookies to[\s\S]*?\n/gi,
    /By continuing to use[\s\S]*?cookies/gi,
  ],
  
  // Newsletter signup forms
  newsletterForms: [
    /newsletter[\s\S]*?(subscribe|sign up|join|email)/gi,
    /sign up for our[\s\S]*?newsletter/gi,
    /get the latest[\s\S]*?in your inbox/gi,
    /enter your email[\s\S]*?to subscribe/gi,
  ],
  
  // Related content / You might also like
  relatedContent: [
    /You may also like[\s\S]*?$/gmi,
    /You might also like[\s\S]*?$/gmi,
    /Related[\s\S]*?articles?/gi,
    /Read more[\s\S]*?\n/gi,
    /More from[\s\S]*?\n/gi,
    /Recommended[\s\S]*?for you/gi,
    /Trending[\s\S]*?now/gi,
  ],
  
  // Social media share buttons
  socialShare: [
    /Share[\s\S]*?(Twitter|Facebook|LinkedIn|Reddit|WhatsApp|Email)/gi,
    /Follow us on[\s\S]*?social media/gi,
    /Tweet[\s\S]*?this/gi,
    /Like[\s\S]*?on Facebook/gi,
    /Share on[\s\S]*?/gi,
    /\bPrint\b[\s\S]*?\bEmail\b/gi,
  ],
  
  // Author bios and bylines (keep the author name but remove the bio)
  authorBios: [
    /By[\s\S]*?\n[\s\S]*?Bio[\s\S]*?\n/gi,
    /Author:[\s\S]*?\n[\s\S]*?Follow/gi,
    /Written by[\s\S]*?\n[\s\S]*?\d+ articles?/gi,
  ],
  
  // Advertisements
  advertisements: [
    /Advertisement[\s\S]*?\n/gi,
    /Sponsored[\s\S]*?content/gi,
    /Sponsored by[\s\S]*?\n/gi,
    /Paid[\s\S]*?promotion/gi,
    /\bAd\b[\s\S]*?\n/gi,
  ],
  
  // Comment sections
  comments: [
    /Comments[\s\S]*?\n/gi,
    /Leave a[\s\S]*?comment/gi,
    /\d+[\s\S]*?comments?/gi,
    /Join the[\s\S]*?conversation/gi,
  ],
  
  // Footer content
  footers: [
    /©[\s\S]*?\d{4}[\s\S]*?All rights reserved/gi,
    /Privacy[\s\S]*?Policy/gi,
    /Terms[\s\S]*?of[\s\S]*?Service/gi,
    /Contact[\s\S]*?Us/gi,
    /About[\s\S]*?Us/gi,
  ],
  
  // Navigation elements
  navigation: [
    /Home[\s\S]*?About[\s\S]*?Contact/gi,
    /Previous[\s\S]*?Next/gi,
    /Page[\s\S]*?\d+/gi,
    /Go to[\s\S]*?top/gi,
  ],
  
  // Copyright notices
  copyright: [
    /Copyright[\s\S]*?\d{4}/gi,
    /All rights reserved/gi,
  ],
  
  // Empty or placeholder content
  placeholders: [
    /\n{4,}/g,
    /\s{100,}/g,
    /&nbsp;{2,}/gi,
  ],
};

/** Telegram-specific filters */
export const TELEGRAM_FILTERS = {
  // Telegram channel headers
  channelHeaders: [
    /^@\w+[\s\S]*?\n/gi,
    /Channel[\s\S]*?info/gi,
    /\d+[\s\S]*?subscribers?/gi,
    /\d+[\s\S]*?members?/gi,
    /Forwarded from/gi,
  ],
  
  // Telegram message metadata
  messageMeta: [
    /\d{1,2}:\d{2}[\s\S]*?\n/gi,  // Timestamps like "14:30"
    /\d{1,2}\.\d{1,2}\.\d{2,4}/gi,  // Dates like "01.01.2024"
    /Edited[\s\S]*?\n/gi,
    /Deleted[\s\S]*?message/gi,
    /Pinned[\s\S]*?message/gi,
  ],
  
  // Telegram formatting artifacts
  formatting: [
    /#{2,}\s/gi,  // Multiple hashes
    /\*{2,}/gi,   // Multiple asterisks
    /_{2,}/gi,    // Multiple underscores
  ],
  
  // Short noisy messages
  shortNoise: [
    /^\+\d+$/gi,  // Just a number
    /^!+$/gi,
    /^\.+$/gi,
    /^\?+$/gi,
  ],
};

/** Reddit-specific filters */
export const REDDIT_FILTERS = {
  // Reddit metadata
  redditMeta: [
    /^r\//gi,
    /^u\//gi,
    /\d+[\s\S]*?points?/gi,
    /\d+[\s\S]*?upvotes?/gi,
    /\d+[\s\S]*?downvotes?/gi,
    /\d+[\s\S]*?comments?/gi,
    /\d+[\s\S]*?awards?/gi,
    /Share[\s\S]*?Save[\s\S]*?Hide/gi,
    /Posted by[\s\S]*?u\//gi,
    /\d+[\s\S]*?days?[\s\S]*?ago/gi,
    /\d+[\s\S]*?hours?[\s\S]*?ago/gi,
    /\d+[\s\S]*?minutes?[\s\S]*?ago/gi,
    /Archived/gi,
    /locked/gi,
    /NSFW/gi,
    /Spoiler/gi,
    /Crosspost/gi,
  ],
  
  // Reddit community info
  communityInfo: [
    /^subreddit[\s\S]*?r\//gi,
    /^Community[\s\S]*?details/gi,
    /Members[\s\S]*?Online/gi,
    /Created[\s\S]*?\d+/gi,
    /Top[\s\S]*?\d+%/gi,
  ],
  
  // Reddit actions
  actions: [
    /Vote[\s\S]*?Comment[\s\S]*?Award/gi,
    /Report[\s\S]*?Save/gi,
    /Give[\s\S]*?Award/gi,
  ],
  
  // Reddit formatting
  redditFormatting: [
    /^\[deleted\]/gi,
    /^\[removed\]/gi,
    /^\*\*\*/gi,
    /^>!/gi,
    /^!</gi,
  ],
};

/** Twitter/X-specific filters (for when bridge is used) */
export const TWITTER_FILTERS = {
  // Twitter metadata
  twitterMeta: [
    /^@\w+/gi,
    /\d+[\s\S]*?Following/gi,
    /\d+[\s\S]*?Followers/gi,
    /\d+[\s\S]*?Likes/gi,
    /\d+[\s\S]*?Retweets/gi,
    /\d+[\s\S]*?Replies/gi,
    /Retweeted[\s\S]*?by/gi,
    /Quote[\s\S]*?Tweet/gi,
    /Liked[\s\S]*?by/gi,
    /\d+[\s\S]*?views?/gi,
  ],
  
  // Twitter timestamps
  timestamps: [
    /\d{1,2}:\d{2}[\s\S]*?(AM|PM)/gi,
    /\d{1,2}\.\d{1,2}\.\d{2,4}/gi,
    /\w{3}[\s\S]*?\d{1,2},[\s\S]*?\d{4}/gi,
  ],
};

/**
 * Apply all filters from a filter set to text
 */
export function applyFilters(text: string, filters: Record<string, RegExp[]>): string {
  let result = text;
  
  for (const [, patterns] of Object.entries(filters)) {
    for (const pattern of patterns) {
      result = result.replace(pattern, "");
    }
  }
  
  // Clean up excessive whitespace left by removals
  result = result
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s{50,}/g, " ")
    .trim();
  
  return result;
}

/**
 * Apply general content filters to clean extracted text
 */
export function filterGeneralContent(text: string): string {
  return applyFilters(text, GENERAL_FILTERS);
}

/**
 * Apply Telegram-specific filters
 */
export function filterTelegramContent(text: string): string {
  return applyFilters(text, TELEGRAM_FILTERS);
}

/**
 * Apply Reddit-specific filters
 */
export function filterRedditContent(text: string): string {
  return applyFilters(text, REDDIT_FILTERS);
}

/**
 * Apply Twitter-specific filters
 */
export function filterTwitterContent(text: string): string {
  return applyFilters(text, TWITTER_FILTERS);
}

/**
 * Get filter for a specific platform
 */
export function getFilterForPlatform(platform: string): (text: string) => string {
  const filters = {
    Telegram: filterTelegramContent,
    Reddit: filterRedditContent,
    X: filterTwitterContent,
    Twitter: filterTwitterContent,
  };
  
  return filters[platform as keyof typeof filters] ?? filterGeneralContent;
}

/**
 * Create a combined filter for a specific source
 */
export function createSourceFilter(platform: string, customFilters?: RegExp[]): (text: string) => string {
  const platformFilter = getFilterForPlatform(platform);
  
  return (text: string) => {
    let result = platformFilter(text);
    
    if (customFilters && customFilters.length > 0) {
      for (const pattern of customFilters) {
        result = result.replace(pattern, "");
      }
    }
    
    return result;
  };
}
