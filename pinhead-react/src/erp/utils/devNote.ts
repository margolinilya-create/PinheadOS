/**
 * КОММЕНТАРИЙ ПО ПРОРАБОТКЕ — ДОРОГА ОТ ТЕХНОЛОГА К ЦЕХУ (правка 13.09, п. 10).
 *
 * «Если комментарий заполнен, сохранить его в карточке разработки как результат
 * этапа проработки и показывать дальше в задаче выбранного участка нанесения,
 * чтобы цех видел важные уточнения по образцу/нанесению».
 *
 * Резолюция живёт ЗДЕСЬ, а не в компонентах: комментарий показывают строка
 * очереди, карточка планшета и страница задания — все три через
 * `StageActionsPanel`, — и вторая копия условия «чей это этап и к какой
 * разработке он относится» разошлась бы молча.
 *
 * Разработка приезжает эмбедом заказа (`developments`), а не своим запросом:
 * у строки очереди иначе появился бы поход в базу на каждое задание. Тот же
 * приём, что у гейта отгрузки с 02.09.
 */

import type { ErpDepartment, ErpItemStage } from '../types';
import type { OrderDevelopment } from '../store/types';

/** Заказ глазами этого модуля: нужны ровно разработки его позиций */
type WithDevelopments = { developments?: OrderDevelopment[] | null };
import { BRANDING_DEPT } from './routes';

/** Коды участков нанесения — те же, что берёт маршрут из методов позиции */
const BRANDING_DEPT_CODES: ReadonlySet<string> = new Set(
  Object.values(BRANDING_DEPT).filter((c): c is string => c !== null),
);

/** Участок нанесения (шелкография, DTF, вышивка) — адресат комментария */
export function isBrandingDept(dept: Pick<ErpDepartment, 'code'> | null | undefined): boolean {
  return Boolean(dept?.code && BRANDING_DEPT_CODES.has(dept.code));
}

/**
 * Комментарий по проработке для ЗАДАНИЯ участка нанесения, или `null`.
 *
 * Показывается только цеху нанесения: документ называет три участка
 * («Шелкография», «DTF», «Вышивка»), и в закрое или пошиве этот текст
 * отвечал бы на вопрос, которого там не задают. Этап, идущий не по образцу,
 * разработки не имеет вовсе — и `developments` по позиции пуст.
 */
export function stageBrandingNote(
  order: WithDevelopments | null | undefined,
  stage: Pick<ErpItemStage, 'item_id'> | null | undefined,
  dept: Pick<ErpDepartment, 'code'> | null | undefined,
): string | null {
  if (!isBrandingDept(dept) || !stage?.item_id) return null;
  const dev = (order?.developments ?? []).find((d) => d.item_id === stage.item_id);
  const note = dev?.branding_note?.trim();
  return note || null;
}
