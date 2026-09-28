/**
 * Гейты ЗАКРЫТИЯ этапа — у писателя статуса (`stagesSlice`), вынесены
 * в свой модуль 27.09: слайс стоял на потолке ратчета размера, а проверки
 * читают три утилиты и два справочника стора и не трогают состояние.
 */
import type { ErpStore } from '../types';
import type { findStage } from '../orderHelpers';
import { stageCompletionBlock } from '../../utils/stageDone';
import { embroideryProgramBlock, isFileResultStage, stageResultFileBlock } from '../../utils/stageResult';
import { materialsForItem } from '../../utils/routes';
import { materialsAfterBypass } from '../../utils/bypass';
import {
  deptAccountsByReports, reportedAccountedBySize, reportedDefect, stageUnaccounted, stageUnaccountedBlock,
} from '../../utils/stageRemaining';
import { sizeInputCells, sizeKey, stageAncestors } from '../../utils/stageSizes';

/**
 * «M — 60 шт, L · чёрный — 44 шт»: не учтено по размерам, в порядке
 * принятого. `null` — размерных данных нет во всей цепочке.
 */
export function unaccountedBreakdown(
  stage: Parameters<typeof sizeInputCells>[0] & { id: string },
  allStages: Parameters<typeof sizeInputCells>[1],
  reports: Parameters<typeof sizeInputCells>[2],
  /**
   * Итог «не учтено» штуками. Разбивка показывается, только если сходится
   * с ним (проба на бою 28.09): часть сдач бывает записана без размеров,
   * и тогда по размерам «не учтено» больше, чем на самом деле, — такая
   * разбивка вводит в заблуждение, честнее её не показать.
   */
  expectedTotal?: number,
): string | null {
  const accounted = reportedAccountedBySize(reports, stage.id);
  const rows = sizeInputCells(stage, allStages, reports)
    .map((c) => ({ c, left: c.qty - (accounted[sizeKey(c.color, c.size)] ?? 0) }))
    .filter(({ left }) => left > 0);
  if (rows.length === 0) return null;
  const sum = rows.reduce((acc, r) => acc + r.left, 0);
  if (expectedTotal !== undefined && sum !== expectedTotal) return null;
  return rows
    .map(({ c, left }) => `${c.color === '—' ? c.size : `${c.size} · ${c.color}`} — ${left} шт`)
    .join(', ');
}

/**
 * ГЕЙТ ЗАВЕРШЕНИЯ ЭТАПА ЖИВЁТ У ПИСАТЕЛЯ, А НЕ У КНОПОК.
 *
 * До 03.09 проверка «закупка не завершена» (правка 30.08, п. 5) стояла в трёх
 * местах интерфейса — `confirmStageDone` у кнопки «Завершить этап» и копия
 * в `onProgress`, — и сторож перечислял вызывающих РУКАМИ. Четвёртый путь
 * в этот список не попал: «Записать результат» у участка с настроенной схемой
 * отчёта (`erp_departments.result_fields`) идёт мимо, прямо в
 * `erp_stage_submit_report`, а тот сам ставит `status='done'`, когда `qty_done`
 * добирает тираж.
 *
 * Цена была не теоретическая: схема отчёта засеяна миграцией
 * `20260810190000` в том числе `cutting` и `sewing` — РОВНО тем двум участкам,
 * у которых непустой `gate_material_kinds` (`20260803120000`). То есть гейт был
 * мёртв именно там, ради чего написан: закрой закрывал этап при неприехавшей
 * ткани и открывал швейке тираж, которого физически нет.
 *
 * Поэтому правило проверяется здесь — у каждой записи, которая может закрыть
 * этап. Пятый путь получит его сам, а не в тот день, когда кто-то вспомнит
 * дописать его в список. Диалог с последствиями (`confirmStageDone`) остаётся
 * в интерфейсе: он объясняет человеку, а не сторожит.
 */
export function completionBlockFor(
  store: ErpStore,
  found: NonNullable<ReturnType<typeof findStage>>,
  addedGood: number,
  /**
   * Запись ЗАКРЫВАЕТ этап (переход в `done`), а не сдаёт часть результата.
   * Программа вышивки держит только закрытие (правка 28.09): «запретить
   * завершение этапа „Вышивка“», а не сдачу части. Сервер при сдаче факт
   * пишет и этап не закрывает.
   */
  final = false,
): string | null {
  const { stage, item, order } = found;
  /**
   * ФАЙЛОВЫЙ РЕЗУЛЬТАТ ПРОВЕРЯЕТСЯ ПЕРВЫМ И БЕЗ ОГЛЯДКИ НА ТИРАЖ
   * (правка 13.09, п. 9). У «Разработки программы вышивки» `qty_done`
   * остаётся нулём по построению, то есть условие «запись добирает тираж»
   * ниже её бы не пустило — а гейт нужен ровно здесь: закрытый без файла
   * этап оставляет вышивальщицу без программы.
   *
   * Гейт стоит У ПИСАТЕЛЯ, а не только у кнопки: кнопка гасится и в очереди,
   * и на странице задания, но закрыть этап можно ещё дорожкой «Завершено»
   * на канбане и чипом производственного плана — там кнопки нет.
   */
  const fileBlock = stageResultFileBlock(stage, order ?? null);
  if (fileBlock) return fileBlock;
  /**
   * ПРОГРАММА ВЫШИВКИ РАНЬШЕ ВЫШИВКИ (правка 27.09, п. 3) — тоже без оглядки
   * на тираж: сдача, добирающая тираж, закрыла бы вышивку без программы
   * ровно так же, как кнопка. Серверное зеркало — `erp_stage_program_block`.
   */
  const programBlock = final ? embroideryProgramBlock(stage, item.stages ?? []) : null;
  if (programBlock) return programBlock;
  // Проверяем ТОЛЬКО когда запись реально добирает тираж: частичная сдача при
  // неприехавшем материале законна — цех отчитывается за то, что сделал.
  if ((stage.qty_done ?? 0) + addedGood < item.qty) return null;
  return stageCompletionBlock({
    stage,
    qty: item.qty,
    allStages: item.stages,
    /**
     * АВАРИЙНОЕ СНЯТИЕ ДЕЙСТВУЕТ И НА ЗАКРЫТИЕ ЭТАПА (правка 03.09).
     *
     * Гейт завершения появился 30.08, аварийный режим — 10.08, и связать их
     * забыли: `materialsAfterBypass` звали только сборщики гейта ВХОДА
     * (`queueEntries`, `shipOrder`). Получалось, что директор снимает
     * проверку, цех видит «Проверка снята вручную» и берёт задание в работу —
     * а закрыть его всё равно не может. Аварийный режим существует ровно для
     * того случая, когда проверка держит работу из-за ошибки в системе;
     * половина выхода — это не выход.
     */
    materials: materialsAfterBypass(
      materialsForItem(order.materials, item.id),
      order.id,
      store.bypasses,
    ),
    dept: store.departments.find((d) => d.id === stage.department_id),
    // Судьба остатков рулонов (правка 27.09, п. 2): нужны этапы всего заказа
    orderItems: order.items,
    itemId: item.id,
  });
}


/**
 * НЕ УЧТЁННЫЕ ИЗДЕЛИЯ ДЕРЖАТ ЗАКРЫТИЕ (правка 27.09, п. 7) — у участка,
 * который отчитывается формой. Окончательный брак лежит в журнале отчётов,
 * а не на этапе, поэтому писатель читает его сам: кнопка, дорожка канбана
 * и чип доски проходят через `setStageStatus` все, и ни одной не нужно
 * помнить о запросе. Файловый результат изделий не имеет.
 *
 * `qtyDoneWrite` — что кнопка собирается записать в `qty_done` (у участка
 * с формой она не пишет ничего, см. `stageDonePatch`).
 */
export async function unaccountedBlockFor(
  store: ErpStore,
  found: NonNullable<ReturnType<typeof findStage>>,
  qtyDoneWrite: number | undefined,
): Promise<string | null> {
  const { stage, item } = found;
  const dept = store.departments.find((d) => d.id === stage.department_id);
  if (!deptAccountsByReports(dept) || isFileResultStage(stage)) return null;
  const allStages = item.stages ?? [];
  // Отчёты предков нужны для разбивки по размерам: «принято» по размеру
  // приходит с закроя, в том числе сквозь нанесение (правка 27.09, п. 6)
  const reports = await store.loadStageReports([stage.id, ...stageAncestors(stage, allStages)]);
  const addedGood = qtyDoneWrite !== undefined
    ? Math.max(qtyDoneWrite - (stage.qty_done ?? 0), 0) : 0;
  const base = {
    stage,
    allStages,
    itemQty: item.qty,
    defectReported: reportedDefect(reports, stage.id),
    addedGood,
  };
  return stageUnaccountedBlock({
    ...base,
    dept,
    // «Показывать причину и размерную разбивку» (правка 28.09) — тем же
    // текстом, что у сервера (`erp_stage_unaccounted_by_size`)
    breakdown: addedGood > 0
      ? null : unaccountedBreakdown(stage, allStages, reports, stageUnaccounted(base)),
  });
}
