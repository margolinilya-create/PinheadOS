import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { withoutJsComments } from './migrations.testutil';

/**
 * НАБОР `('done','cancelled')` НЕ ПИШЕТСЯ ОТ РУКИ.
 *
 * ЗАЧЕМ. К 07.09 это условие было расписано в ПЯТНАДЦАТИ местах: три
 * именованные копии (`CLOSED` в `experimentalTasks`, `CLOSED` в
 * `experimentalBoard`, `CLOSED_STATUS` в `DevTasksSection`) и двенадцать
 * инлайновых выражений по утилитам и экранам. Проект на этом уже обжигался:
 * копия в `Experimental.jsx` успела разойтись — проверяла `!== 'done'` без
 * `'cancelled'`, — и ОТМЕНЁННАЯ задача нанесения держала карточку в шаге,
 * не пуская её в «Пошив». Под тот случай завели `devBranding.test.ts`, но он
 * покрывает ОДНУ формулу; остальные носители не покрывал никто.
 *
 * ТРИ ВЕЛИЧИНЫ, А НЕ ОДНА. Слова совпадают, вопросы разные:
 *
 *   `isDevTaskClosed`     — закрыта ли задача разработки (`erp_experimental_tasks`)
 *   `isProcurementClosed` — закрыта ли задача дозакупки (`erp_procurement_tasks`)
 *   `isPlanSlotClosed`    — закрыт ли день плана (`erp_calendar_slots`)
 *
 * Свести их в одну функцию было бы обобщением ПО СОВПАДЕНИЮ НАПИСАНИЯ — той же
 * ошибкой, от которой предостерегает правило про `deptsSettled` («прежде чем
 * обобщать, проверьте, что общее — не только название»). Поэтому сторож
 * запрещает не «набор слов», а РУКОПИСНОЕ ЕГО ПОВТОРЕНИЕ: у каждой величины
 * есть свой предикат, и звать надо его.
 *
 * ЧТО СТОРОЖ НЕ ЛОВИТ, СКАЗАНО ЧЕСТНО: он ищет текстовый шаблон, поэтому
 * копия, записанная иначе (через `includes`, через массив, через switch),
 * пройдёт мимо. Это не повод её писать — это граница проверки.
 */

const ROOT = join(process.cwd(), 'src', 'erp');

/** Файлы, где предикаты и объявлены: там набор стоит по праву */
const OWNERS = new Set([
  'utils/experimentalTasks.ts',  // isDevTaskClosed
  'utils/routes.ts',             // isProcurementClosed
  'utils/planCard.ts',           // isPlanSlotClosed
]);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx|js|jsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

/**
 * Рукописная ПРОВЕРКА «статус закрыт»: сравнение с 'done' и с 'cancelled'
 * в одном выражении — в любом порядке и в любой форме (`===` или `!==`).
 *
 * СРАВНЕНИЕ ОБЯЗАТЕЛЬНО, иначе шаблон ловит объявления перечислений
 * (`type SlotStatus = … | 'done' | … | 'cancelled'`), где оба слова стоят
 * по праву: там они ОБЪЯВЛЯЮТСЯ, а не проверяются. Сторож, падающий
 * на объявлении типа, учит обходить себя, а не писать правильно.
 */
const HANDWRITTEN = [
  /[=!]==\s*['"]done['"][^\n]{0,80}[=!]==\s*['"]cancelled['"]/,
  /[=!]==\s*['"]cancelled['"][^\n]{0,80}[=!]==\s*['"]done['"]/,
];

describe('«задача закрыта» пишется предикатом, а не набором слов', () => {
  const files = sources(ROOT);

  it('в корпусе вообще есть что проверять', () => {
    // Сторож, ничего не нашедший, зелен по той же причине, что и исправный
    expect(files.length).toBeGreaterThan(50);
  });

  it('ни один файл, кроме владельцев предикатов, не повторяет набор от руки', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
      if (OWNERS.has(rel)) continue;
      // Комментарии снимаем: объяснение, ПОЧЕМУ копии больше нет, содержит
      // те же слова, что и сама копия — на этом сторожа проекта уже спотыкались
      const code = withoutJsComments(readFileSync(file, 'utf8'));
      for (const line of code.split('\n')) {
        if (HANDWRITTEN.some((re) => re.test(line))) {
          offenders.push(`${rel}: ${line.trim().slice(0, 90)}`);
        }
      }
    }
    expect(
      offenders,
      'зовите isDevTaskClosed / isProcurementClosed / isPlanSlotClosed — какой '
      + 'именно, зависит от того, ЧЬЮ закрытость вы спрашиваете',
    ).toEqual([]);
  });

  it('у каждой из трёх величин предикат на месте', () => {
    // Иначе список владельцев выше начнёт разрешать копии в файлах,
    // где предиката уже нет
    const owners: [string, string][] = [
      ['utils/experimentalTasks.ts', 'isDevTaskClosed'],
      ['utils/routes.ts', 'isProcurementClosed'],
      ['utils/planCard.ts', 'isPlanSlotClosed'],
    ];
    for (const [rel, name] of owners) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(src, `${rel} больше не объявляет ${name}`).toContain(`export function ${name}(`);
    }
  });
});
