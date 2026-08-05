/**
 * Возврат брака на предыдущий этап: что именно откатится.
 *
 * `reportDefect` переоткрывает не только выбранный этап, но и ВСЕ уже пройденные
 * после него — перекроенные единицы обязаны заново пройти их, иначе застрянут
 * в `done`. Логика правильная, но в интерфейсе её не было видно: в выпадающем
 * списке рабочий выбирал «Вернуть: Швейка» и не знал, что заодно откатятся
 * ВТО и Печать, а цеха внезапно получали обратно сданную работу.
 *
 * Здесь считается ровно то же, что в слайсе, — чтобы текст подтверждения
 * не разошёлся с фактическим действием.
 *
 * Считаем по ГРАФУ `depends_on`, а не по интервалу `sort_order`. Ветки нанесения
 * получают ОДИНАКОВЫЙ `sortOrder` (в `buildRoute` счётчик не инкрементируется
 * внутри цикла веток), и отсечка «строго меньше верхней границы» выбрасывала
 * соседнюю ветку: в маршруте `закрой(20) → [вышивка(30), шелкография(30)] →
 * швейка(40)` возврат брака из вышивки в закрой оставлял шелкографию в `done`
 * с полным тиражом. Закрой перекраивал, вышивка обрабатывала, швейка ждала обе
 * ветки — и партия уходила в пошив БЕЗ ПЕЧАТИ. Обнаружилось бы на ОТК или
 * у клиента. Заодно исчезла зависимость от совпадения номеров.
 */

import { confirm } from '../../store/useConfirmStore';
import type { ErpItemStage } from '../types';

/**
 * Минимум полей этапа, нужный расчёту возврата брака.
 *
 * `qty_done`/`qty_rework` входят сюда, потому что слайс берёт их прямо
 * с результата `intermediateReopened` (уменьшает сделанное, увеличивает
 * переделку). Без них tsc ругался в `stagesSlice`, а страховала только
 * выключенная строгость: тип обещал меньше, чем от него уже требовали.
 */
type DefectStage = Pick<
  ErpItemStage,
  'id' | 'department_id' | 'sort_order' | 'status' | 'depends_on'
> & Partial<Pick<ErpItemStage, 'qty_done' | 'qty_rework'>>;

export interface DefectRollbackInput {
  /** Этап, на котором оформляют брак */
  stage: DefectStage;
  /** Этап, куда возвращают (null для спец-целей: закупка, подрядчик, текущий) */
  targetStage: DefectStage | null;
  /** Все этапы позиции */
  allStages: DefectStage[];
  /** id цеха → короткое имя */
  deptNameById?: Map<string, string>;
}

/**
 * Транзитивные потомки этапа по графу `depends_on`: все, кто зависит от него
 * прямо или через цепочку. Сам этап в результат не входит.
 *
 * Обход по слоям с множеством посещённых — граф маршрута ациклический
 * по построению, но защита от петли стоит дешевле разбирательства с зависшей
 * вкладкой, если данные окажутся кривыми.
 */
export function descendantStages(allStages: DefectStage[], rootId: string): DefectStage[] {
  const out: DefectStage[] = [];
  const seen = new Set<string>([rootId]);
  let frontier = new Set<string>([rootId]);
  while (frontier.size > 0) {
    const next = new Set<string>();
    for (const s of allStages) {
      if (seen.has(s.id)) continue;
      if (!(s.depends_on ?? []).some((d) => frontier.has(d))) continue;
      seen.add(s.id);
      out.push(s);
      next.add(s.id);
    }
    frontier = next;
  }
  return out;
}

/**
 * Этапы, которые переоткроются вместе с целевым: всё, что идёт ПОСЛЕ него
 * по маршруту и уже обработало эти единицы.
 *
 * Статус и делает отбор осмысленным: ещё не начатый этап (`waiting`) эти единицы
 * не видел, откатывать в нём нечего. Поэтому «швейка ждёт обе ветки» сама собой
 * остаётся нетронутой, а сданная соседняя ветка — переоткрывается.
 */
export function intermediateReopened(input: DefectRollbackInput): DefectStage[] {
  const { stage, targetStage, allStages } = input;
  if (!targetStage) return [];
  return descendantStages(allStages, targetStage.id).filter((mid) => {
    if (mid.id === stage.id) return false;
    return mid.status === 'done' || mid.status === 'in_progress';
  });
}

function name(s: DefectStage, map?: Map<string, string>): string {
  return map?.get(s.department_id) || 'этап';
}

/**
 * Текст подтверждения или `null`, если спрашивать нечего.
 * Спрашиваем только когда цель — конкретный этап: «устранить на текущем»,
 * «на закупку» и «подрядчику» ничего чужого не откатывают.
 */
export function defectRollbackWarning(
  input: DefectRollbackInput & { qty: number },
): string | null {
  const { targetStage, qty, deptNameById } = input;
  if (!targetStage) return null;

  const parts = [`${qty} шт вернутся в «${name(targetStage, deptNameById)}».`];
  const mids = intermediateReopened(input);
  if (mids.length > 0) {
    const names = mids.map((m) => name(m, deptNameById)).join(', ');
    parts.push(`Заодно переоткроются: ${names} — перекроенные единицы пройдут их заново.`);
  }
  return parts.join(' ');
}

/** Спросить перед возвратом брака. `true` — можно оформлять. */
export async function confirmDefectRollback(
  input: DefectRollbackInput & { qty: number },
): Promise<boolean> {
  const warning = defectRollbackWarning(input);
  if (!warning) return true;
  return confirm({
    title: 'Вернуть брак на предыдущий этап?',
    message: warning,
    confirmLabel: 'В переделку',
    variant: 'danger',
  });
}
