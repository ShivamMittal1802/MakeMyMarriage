const dayFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
export const dayLabel = (value: string) => dayFormat.format(new Date(value));
export const timeLabel = (value: string) => timeFormat.format(new Date(value));
// Wedding times are entered in IST regardless of the organiser's device timezone.
export function localParts(value?: string) {
  if (!value) return { date: "", time: "" };
  const local = new Date(Date.parse(value) + 330 * 60_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}
export function toInstant(date: string, time: string, original?: string) {
  const prior = localParts(original);
  if (original && date === prior.date && time === prior.time) return original;
  return new Date(`${date}T${time}:00+05:30`).toISOString();
}
