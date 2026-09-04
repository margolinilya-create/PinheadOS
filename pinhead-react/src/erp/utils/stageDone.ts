/**
 * Закрытие этапа «целиком»: что именно случится с незакрытым количеством.
 *
 * Кнопка «Завершить этап» (и дорожка «Завершено» на канбане, и чип на
 * производственном плане) пишет `qty_done = item.qty`, то есть **весь тираж**,
 * независимо от того, сколько цех реально сдал. Если сдали 40 из 100, в системе
 * окажется 100: следующий цех получит 100 шт, которых физически нет, а в
 * производственной статистике останется приписка.
 *
 * DESIGN.md требует подтверждения именно для «незакрытого количества», поэтому
 * здесь считается текст последствий, а сам диалог — в `confirmStageDone`.
 * Разделено, чтобы формулировку можно было проверить тестом без диалогов.
 */

import { confirm } from '../../store/useConfirmStore';
import { toast } from '../../store/useToastStore';
import { materialsBlockingCompletion } from './supply';
import type { ErpDepartment, ErpItemStage, ErpMaterial } from '../types';

/**
 * То, что нужно для ТЕКСТА последствий — без материалов: расчёт «сколько
 * допишется» от закупки не зависит, и требовать её здесь значило бы тащить
 * материалы в тесты формулировок.
 */
export interface StageDoneWarningInput {
  /** Закрываемый этап */
  /**
   * `qty_done` объявлен `number`, но в базе он nullable и код ниже честно
   * читает его через `?? 0`. Тип обязан это признавать, иначе тест «не
   * проставлен — считается за ноль» невозможно даже написать.
   */
  stage: Pick<ErpItemStage, 'id'> & { qty_done: number | null };
  /** Тираж позиции */
  qty: number;
  /** Все этапы позиции — чтобы назвать те, что разблокируются */
  allStages: Pick<ErpItemStage, 'id' | 'department_id' | 'depends_on'>[];
  /** id цеха → короткое имя */
  deptNameById?: Map<string, string>;
}

/**
 * То, что нужно ДЕЙСТВИЮ закрытия этапа: к тексту последствий добавляется
 * гейт закупки (правка 30.08, п. 5).
 *
 * Материалы и цех обязательны. Необязательными их делать нельзя: гейт молча
 * пропустил бы забытого вызывающего, а вызывающих трое (очередь цеха,
 * дорожка канбана, чип доски) и все они на JS, где тайпчек этого не поймает.
 * Сторож — `stageDone.test.ts`, он читает исходники всех трёх точек.
 */
export interface StageDoneInput extends StageDoneWarningInput {
  /** Материалы ПОЗИЦИИ (`materialsForItem`), а не всего заказа */
  materials: readonly ErpMaterial[];
  /** Цех этапа — от его `gate_material_kinds` зависит, гейтится ли он вовсе */
  dept: Pick<ErpDepartment, 'gate_material_kinds'> | null | undefined;
}

/** Этапы, которые ждут именно этот (после закрытия они откроются) */
export function dependentStageNames(input: StageDoneWarningInput): string[] {
  const { stage, allStages, deptNameById } = input;
  return allStages
    .filter((s) => s.depends_on.includes(stage.id))
    .map((s) => deptNameById?.get(s.department_id) || 'следующий этап');
}

/**
 * Текст предупреждения или `null`, если закрывать можно молча.
 * Молча — только когда цех уже отчитался за весь тираж: тогда «Завершить этап»
 * ничего не дописывает и подтверждать нечего.
 */
export function stageDoneWarning(input: StageDoneWarningInput): string | null {
  const { stage, qty } = input;
  const done = stage.qty_done ?? 0;
  const remaining = qty - done;
  if (remaining <= 0) return null;

  const parts = [
    `Цех отчитался за ${done} из ${qty} шт.`,
    `Оставшиеся ${remaining} шт будут записаны как выполненные.`,
  ];
  const next = dependentStageNames(input);
  if (next.length > 0) {
    parts.push(`Следующий этап (${next.join(', ')}) откроется на полный тираж ${qty} шт.`);
  }
  return parts.join(' ');
}

/**
 * Почему этап нельзя закрыть, пока не закрыта закупка (правка 30.08, п. 5),
 * или `null`, если закрывать можно.
 *
 * Отказ ОБЯЗАН называть себя и перечислять позиции: цех, у которого кнопка
 * гаснет молча, читает это как поломку сайта и идёт к диспетчеру. Позиции
 * перечислены поимённо, чтобы было видно, кому звонить.
 */
export function stageCompletionBlock(input: StageDoneInput): string | null {
  const blocking = materialsBlockingCompletion(input.materials, input.dept);
  if (blocking.length === 0) return null;
  const names = blocking.slice(0, 4).map((m) => m.name).join(', ');
  const rest = blocking.length > 4 ? ` и ещё ${blocking.length - 4}` : '';
  /**
   * «Придут ИЛИ будут взяты со склада» описывало половину условия: с 04.09
   * пришедший закупочный материал держит этап, пока склад не оформил приёмку.
   * Человеку, у которого материал физически ПРИШЁЛ, прежний текст читался
   * как ошибка системы. Слова обязаны совпадать с серверным зеркалом
   * (`erp_stage_completion_block`) — один список и в кнопке, и в отказе.
   */
  return `Закупка не завершена: ${names}${rest}. `
    + 'Этап можно закрыть, когда материалы придут и склад их примет.';
}

/**
 * Спросить перед закрытием этапа. Единая точка для всех трёх мест, откуда этап
 * закрывается целиком: очередь цеха, дорожка «Завершено» на канбане и чип
 * производственного плана. Возвращает `true`, если можно закрывать.
 */
export async function confirmStageDone(input: StageDoneInput): Promise<boolean> {
  /**
   * Гейт закупки стоит ПЕРЕД предупреждением о дописанном тираже: это отказ,
   * а не выбор, и спрашивать «записать остаток?» у действия, которое всё
   * равно не состоится, значит предлагать несуществующее решение.
   */
  const blocked = stageCompletionBlock(input);
  if (blocked) {
    toast.error(blocked);
    return false;
  }
  const warning = stageDoneWarning(input);
  if (!warning) return true;
  return confirm({
    title: 'Завершить этап не полностью?',
    message: warning,
    confirmLabel: 'Завершить',
    variant: 'danger',
  });
}
