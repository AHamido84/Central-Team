/** Pure helpers for portal links that carry a client (FR4.3, ADR-091) — shared by the switch route and notify(). */

const isPortalPath = (path: string) => path === '/portal' || path.startsWith('/portal/') || path.startsWith('/portal?');

/** Only portal paths: the switch link must never become an open redirect. */
export function safePortalPath(next: string | null | undefined): string {
  if (!next || !isPortalPath(next) || next.startsWith('//') || next.includes('\\')) return '/portal';
  return next;
}

/** A portal link that first selects the notification's client (`/portal/switch`); other links stay as they are. */
export function clientLink(link: string, clientId: string | null): string {
  if (!clientId || !isPortalPath(link) || link.startsWith('/portal/switch')) return link;
  return `/portal/switch?client=${clientId}&next=${encodeURIComponent(link)}`;
}
