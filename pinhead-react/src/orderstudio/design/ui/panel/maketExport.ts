/**
 * Загрузчики кнопки «Скачать PDF макета» (веха 5а, задача 7) без React.
 * Отдельным модулем — файл компонента экспортирует только компонент
 * (быстрое обновление Vite).
 *
 * В чанке холста (потолок 100 кБ gzip, README модуля) — только этот лёгкий
 * модуль и признак «есть что скачать». Листы, проверка перед сборкой и имя
 * файла (`maketTools`) грузятся по клику, движок PDF (`export/exportPdf`) — тоже.
 */
import { handlePossibleUpdate } from '../../../../lib/appUpdate';
import { toast } from '../../../../store/useToastStore';
import type { SalesItem } from '../../../model/types';
import type { GarmentFlat } from '../../types';
import { placementOf } from '../../model/layout';

export const MSG_ENGINE = 'Сборка PDF не загрузилась — обновите страницу и повторите';

/** Загрузчик движка PDF — единственный `import()` модуля; в тестах подменяется (сбой чанка) */
export const pdfEngine = { load: () => import('../../export/exportPdf') };

/** Движок PDF по требованию; не загрузился — `null` (диалог «Вышло обновление» или тост уже показаны) */
export async function loadPdfEngine(): Promise<typeof import('../../export/exportPdf') | null> {
  try {
    return await pdfEngine.load();
  } catch (e) {
    console.error('ExportPdfButton: движок PDF', e);
    if (!handlePossibleUpdate(e)) toast.error(MSG_ENGINE);
    return null;
  }
}

/** Листы и проверка перед сборкой — по клику; в тестах подменяется (сбой чанка) */
export const maketToolsChunk = { load: () => import('./maketTools') };

/** Листы, проверка и имя файла по требованию; не загрузились — `null` (как у движка) */
export async function loadMaketTools(): Promise<typeof import('./maketTools') | null> {
  try {
    return await maketToolsChunk.load();
  } catch (e) {
    console.error('ExportPdfButton: листы макета', e);
    if (!handlePossibleUpdate(e)) toast.error(MSG_ENGINE);
    return null;
  }
}

/**
 * Есть ли что скачать: хоть одно нанесение стоит на этом флэте. Равно
 * `maketPages(item, flat).length > 0` (`placementOf` отдаёт только вид
 * «перед»/«спина», который есть у флэта; тест-эталон рядом) — без загрузки листов.
 */
export function hasMaketPages(item: Pick<SalesItem, 'prints'>, flat: GarmentFlat | null): boolean {
  return Boolean(flat) && item.prints.some((p) => placementOf(p, flat as GarmentFlat));
}
