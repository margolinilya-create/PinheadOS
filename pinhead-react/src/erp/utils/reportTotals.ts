import type { StageReportSizeInput } from '../types';

interface RollLike { roll_id?: string | null; sizes?: StageReportSizeInput[] }

interface ReportInput {
  qtyGood?: number;
  qtyDefect?: number;
  qtyRework?: number;
  qtyExtra?: number;
  sizes?: StageReportSizeInput[];
  rolls?: RollLike[];
}

export interface ReportTotals<R extends RollLike> {
  sizes: StageReportSizeInput[];
  rolls: R[];
  good: number;
  defect: number;
  rework: number;
  extraQty: number;
}

/**
 * ЧИСЛА ОТЧЁТА ЦЕХА — из разбивки, если она есть (правки 16.09).
 *
 * Рулоны задают выход раскроя, размеры — результат по размерам, скаляры —
 * всё остальное. Ровно то же правило стоит внутри `erp_stage_submit_report`,
 * и это не дублирование, а согласование: клиентские проверки (гейт закупки,
 * «внесите хотя бы одно число») обязаны судить по ТЕМ ЖЕ числам, которые
 * запишет сервер. Иначе форма отказала бы там, где сервер записал, — или
 * наоборот, а это и есть запрещённое «кнопка есть, действие падает».
 *
 * Вынесено из `stagesSlice` (27.09): слайс стоит на потолке ратчета размера.
 */
export function reportTotals<R extends RollLike>(input: ReportInput & { rolls?: R[] }): ReportTotals<R> {
  const sizes = (input.sizes ?? []).filter((s) => s?.size);
  const rolls = (input.rolls ?? []).filter((r): r is R => Boolean(r?.roll_id));
  const sizeSum = (pick: (s: StageReportSizeInput) => number | undefined): number =>
    sizes.reduce((acc, s) => acc + Math.max(pick(s) ?? 0, 0), 0);
  const rollSum = rolls.reduce(
    (acc, r) => acc + (r.sizes ?? []).reduce((s, c) => s + Math.max(c.qty_good ?? 0, 0), 0),
    0,
  );
  const scalar = (v: number | undefined) => Math.max(v ?? 0, 0);
  return {
    sizes,
    rolls,
    good: rolls.length > 0
      ? rollSum
      : (sizes.length > 0 ? sizeSum((s) => s.qty_good) : scalar(input.qtyGood)),
    /**
     * У сдачи ПО РУЛОНАМ (закрой) брак, переделка и плюс — скаляры формы,
     * как и у сервера (`v_rolled` в `erp_stage_submit_report`): размерные
     * строки закроя несут только годные. Прежде брак брался из них и терялся
     * по дороге — форма требовала комментарий к браку, а на сервер уходил 0
     * (правка 28.09).
     */
    defect: sizes.length > 0 && rolls.length === 0 ? sizeSum((s) => s.qty_defect) : scalar(input.qtyDefect),
    rework: sizes.length > 0 && rolls.length === 0 ? sizeSum((s) => s.qty_rework) : scalar(input.qtyRework),
    extraQty: sizes.length > 0 && rolls.length === 0 ? sizeSum((s) => s.qty_extra) : scalar(input.qtyExtra),
  };
}
