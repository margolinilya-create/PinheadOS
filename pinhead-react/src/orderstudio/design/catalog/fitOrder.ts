// Порядок посадок в списке флэтов. Перенос DM `lib/catalog/fitOrder.ts`.
// От меньшей к большей: Classic → Regular → Free/FreeFit → Oversize; Crop идёт
// после своей базовой посадки. Посадка распознаётся по имени; неизвестные —
// в конец по алфавиту.

const FIT_RANKS: [RegExp, number][] = [
  [/classic/i, 0],
  [/regular/i, 1],
  [/free/i, 2], // раньше oversize: «FreeFit (oversized)» — это фри
  [/oversize/i, 3],
];

export function fitRank(name: string): number {
  let rank = 10;
  for (const [re, r] of FIT_RANKS) {
    if (re.test(name)) {
      rank = r;
      break;
    }
  }
  return /crop/i.test(name) ? rank + 0.5 : rank;
}

/** Сортировка по посадке (стабильно; при равенстве — имя по алфавиту) */
export function sortByFit<T extends { name: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => fitRank(a.name) - fitRank(b.name) || a.name.localeCompare(b.name, 'ru'));
}
