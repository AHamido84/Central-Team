export const clientStatuses = ['onboarding', 'active', 'paused', 'archived'] as const;
export type ClientStatus = (typeof clientStatuses)[number];

export const clientStatusTone = {
  onboarding: 'info',
  active: 'success',
  paused: 'warning',
  archived: 'neutral',
} as const satisfies Record<ClientStatus, string>;

export const industries = [
  'food_beverage',
  'retail',
  'healthcare',
  'real_estate',
  'hospitality',
  'education',
  'automotive',
  'technology',
  'finance',
  'beauty',
  'government',
  'other',
] as const;

export const cities = ['riyadh', 'jeddah', 'dammam', 'khobar', 'makkah', 'madinah', 'abha', 'taif', 'tabuk', 'qassim', 'other'] as const;

export const socialNetworks = ['instagram', 'x', 'tiktok', 'snapchat', 'linkedin', 'youtube'] as const;
export type SocialNetwork = (typeof socialNetworks)[number];

export const socialUrl: Record<SocialNetwork, (handle: string) => string> = {
  instagram: (h) => `https://instagram.com/${h}`,
  x: (h) => `https://x.com/${h}`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  snapchat: (h) => `https://www.snapchat.com/add/${h}`,
  linkedin: (h) => `https://www.linkedin.com/company/${h}`,
  youtube: (h) => `https://www.youtube.com/@${h}`,
};

/** Deliverable types a package can include. Later phases map deliverables to these keys. */
export const packageItemTypes = ['post', 'reel', 'story', 'video', 'design', 'photo_shoot', 'ad_campaign', 'blog_article', 'revision_round'] as const;
export type PackageItemType = (typeof packageItemTypes)[number];

export const clientRoleKeys = ['client_owner', 'client_member', 'client_viewer'] as const;
export type ClientRoleKey = (typeof clientRoleKeys)[number];
