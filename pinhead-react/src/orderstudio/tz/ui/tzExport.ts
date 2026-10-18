/**
 * Загрузчик движка PDF ТЗ (веха 6+7, задача 3; К5) — единственный `import()`
 * модуля `tz/pdf/tzPdf` (сторож `pdfGuards.test.ts`). По образцу
 * `design/ui/panel/maketExport.ts`: экран («ТЗ и цена», задача 5; «К запуску»,
 * задача 6) держит статически только этот лёгкий модуль, а движок с jsPDF
 * и svg2pdf (`vendor-pdf`) приезжает по клику.
 *
 * Бюджет: строка `tzExport` в `SummaryTab.jsx` или `LaunchScreen.jsx`
 * включает проверку «ТЗ PDF» (`scripts/bundle-budget-m67.mjs`) — загрузчик
 * обязан жить в живом коде, иначе Rollup выбросит чанк вместе с `import()`.
 */
import { handlePossibleUpdate } from '../../../lib/appUpdate';
import { toast } from '../../../store/useToastStore';

export const MSG_TZ_ENGINE = 'Сборка ТЗ не загрузилась — обновите страницу и повторите';

type TzEngine = typeof import('../pdf/tzPdf');

/** Загрузчик движка; в тестах подменяется (сбой чанка) */
export const tzEngine = { load: (): Promise<TzEngine> => import('../pdf/tzPdf') };

/** Движок PDF ТЗ; сбой загрузки чанка — исключение (его разбирает вызывающий) */
export const loadTzEngine = (): Promise<TzEngine> => tzEngine.load();

/** Движок по требованию; не загрузился — `null` (диалог «Вышло обновление» или тост уже показаны) */
export async function loadTzEngineOrNull(): Promise<TzEngine | null> {
  try {
    return await tzEngine.load();
  } catch (e) {
    console.error('tzExport: движок PDF ТЗ', e);
    if (!handlePossibleUpdate(e)) toast.error(MSG_TZ_ENGINE);
    return null;
  }
}
