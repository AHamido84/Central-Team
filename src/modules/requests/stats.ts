import { openStatuses, type RequestStatus } from '@/modules/requests/constants';

const DAY = 86_400_000;

/** Portal dashboard numbers from the client's requests (pure, so it's unit-tested). */
export function clientRequestStats(
  requests: readonly { status: RequestStatus; submittedAt: string | null; deliveredAt: string | null }[],
  timeZone = 'Asia/Riyadh',
  now: Date = new Date(),
) {
  const month = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(d);
  const thisMonth = month(now);
  const delivered = requests.filter((r) => r.deliveredAt && r.submittedAt);
  const recent = delivered.filter((r) => now.getTime() - new Date(r.deliveredAt!).getTime() <= 90 * DAY);
  const avg = recent.length
    ? recent.reduce((sum, r) => sum + (new Date(r.deliveredAt!).getTime() - new Date(r.submittedAt!).getTime()), 0) / recent.length / DAY
    : null;
  return {
    open: requests.filter((r) => openStatuses.includes(r.status)).length,
    waiting: requests.filter((r) => r.status === 'needs_info').length,
    deliveredThisMonth: delivered.filter((r) => month(new Date(r.deliveredAt!)) === thisMonth).length,
    avgTurnaroundDays: avg,
  };
}
