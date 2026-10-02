import { describe, expect, it } from 'vitest';

import { clientLink, safePortalPath } from '@/modules/clients/portal-links';

const CLIENT = '0199a1b2-0000-7000-8000-000000000001';

describe('safePortalPath (switch route redirect, FR4.3)', () => {
  it('keeps portal paths with their query', () => {
    expect(safePortalPath('/portal')).toBe('/portal');
    expect(safePortalPath('/portal/requests/abc?tab=files')).toBe('/portal/requests/abc?tab=files');
  });

  it('never redirects outside the portal', () => {
    for (const next of [null, undefined, '', '/dashboard', 'https://evil.test', '//evil.test', '/portalx', '/portal\\..\\admin']) {
      expect(safePortalPath(next)).toBe('/portal');
    }
  });
});

describe('clientLink (notifications for multi-client portal users, FR4.3)', () => {
  it('routes a portal link through the switch route for the notification client', () => {
    expect(clientLink('/portal/approvals/1', CLIENT)).toBe(`/portal/switch?client=${CLIENT}&next=%2Fportal%2Fapprovals%2F1`);
  });

  it('leaves agency links, links without a client, and switch links alone', () => {
    expect(clientLink('/tasks/1', CLIENT)).toBe('/tasks/1');
    expect(clientLink('/portal/requests', null)).toBe('/portal/requests');
    const already = `/portal/switch?client=${CLIENT}&next=%2Fportal`;
    expect(clientLink(already, CLIENT)).toBe(already);
  });

  it('round-trips: the switch route accepts what clientLink produced', () => {
    const url = new URL(clientLink('/portal/files?folder=2', CLIENT), 'http://x');
    expect(safePortalPath(url.searchParams.get('next'))).toBe('/portal/files?folder=2');
  });
});
