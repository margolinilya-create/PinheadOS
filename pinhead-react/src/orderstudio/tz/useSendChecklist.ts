/**
 * Чек-лист отправки для рабочего места (веха 6+7, задача 5): модель ТЗ
 * (`sendChecklist` → `tzDocument`, глифы) грузится `import()` — в граф
 * «Рабочего места» она не попадает (бюджет `bundle-budget-m67`). Пока модуль
 * не приехал или справочников нет — `null` (кнопка отправки ждёт); чанк не
 * загрузился — тост (или плашка «Вышло обновление»), кнопка остаётся недоступной.
 *
 * Только черновик: у отправленного заказа чек-листа на «ТЗ и цена» нет.
 */
import { useEffect, useMemo, useState } from 'react';
import { handlePossibleUpdate } from '../../lib/appUpdate';
import { toast } from '../../store/useToastStore';
import type { SalesOrder } from '../model/types';
import type { CheckItem } from './model/sendChecklist';
import type { TzCatalogs } from './model/tzDocTypes';

export const MSG_CHECKLIST_FAILED = 'Чек-лист отправки не загрузился — обновите страницу';

type ChecklistModule = typeof import('./model/sendChecklist');

/** Загрузчик модуля (в тестах подменяется) */
export const checklistModule = { load: (): Promise<ChecklistModule> => import('./model/sendChecklist') };

export function useSendChecklist(
  order: SalesOrder | null,
  catalogs: TzCatalogs | null,
  margin: { marginPct: number | null; minMarginPct: number | null },
): CheckItem[] | null {
  const [mod, setMod] = useState<ChecklistModule | null>(null);
  const [failed, setFailed] = useState(false);
  const wanted = !!order && order.status === 'draft';

  useEffect(() => {
    if (!wanted || mod || failed) return undefined;
    let alive = true;
    checklistModule.load().then(
      (m) => { if (alive) setMod(m); },
      (e) => {
        console.error('Чек-лист отправки', e);
        // Устаревшая вкладка — плашка «Вышло обновление»; иначе — тост
        if (!handlePossibleUpdate(e)) toast.error(MSG_CHECKLIST_FAILED);
        if (alive) setFailed(true);
      },
    );
    return () => { alive = false; };
  }, [wanted, mod, failed]);

  const { marginPct, minMarginPct } = margin;
  return useMemo(() => {
    if (!wanted || !order || !catalogs || !mod) return null;
    return mod.sendChecklist(order, catalogs, { marginPct, minMarginPct });
  }, [wanted, order, catalogs, mod, marginPct, minMarginPct]);
}
