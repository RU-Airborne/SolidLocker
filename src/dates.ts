/** One place to change how dates display app-wide. */

export function formatDate(when: string | number | Date): string {
  return new Date(when).toLocaleDateString();
}

export function formatDateTime(when: string | number | Date): string {
  const d = new Date(when);
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${d.toLocaleDateString()} ${time}`;
}
