/**
 * Дата запуска по умолчанию (решение 22): следующий рабочий день, пн–пт,
 * без календаря праздников (бэклог). Дата — аргументом: «сейчас» передаёт
 * вызывающий, день недели — по местному времени (на экране — Москва; тесты
 * идут в `TZ=Europe/Moscow`).
 */

const p2 = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` по местному времени */
export function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** Следующий рабочий день после `now`: пт, сб, вс → понедельник */
export function nextWorkingDay(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return isoLocal(d);
}
