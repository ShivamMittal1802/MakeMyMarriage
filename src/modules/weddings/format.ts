export const roleLabels = {
  bride: "Bride",
  groom: "Groom",
  manager: "Helping organise — Manager",
};
export function displayDate(value: string) {
  return value
    ? new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      }).format(new Date(`${value}T00:00:00Z`))
    : "Your wedding date";
}
