/**
 * Office-local time helpers. The server stamps all attendance times; "today" and the late cutoff are
 * evaluated in the office timezone (env OFFICE_TZ, default Asia/Karachi), never in the host/UTC zone.
 */
export const OFFICE_TZ = process.env.OFFICE_TZ || 'Asia/Karachi';

export function officeNow(d: Date = new Date()): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: OFFICE_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function officeToday(): string {
  return officeNow().date;
}
