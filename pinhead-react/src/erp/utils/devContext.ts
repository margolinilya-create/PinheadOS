import type { ErpItemStage, ErpMaterial } from '../types';
import type { DevBoardInput } from './experimentalBoard';
import {
  cuttingGate, devBoardColumn, devBrandingFromPrints, devBrandingOpen, devStageStates,
  type DevStage, type DevStageState,
} from './experimentalBoard';
import { findSupplyDept, openSupplyStages } from './supply';

/**
 * КОНТЕКСТ ОДНОЙ РАЗРАБОТКИ — ОДИН РАСЧЁТ НА СТРАНИЦУ И КАРТОЧКУ.
 *
 * ЧТО БЫЛО. `DevPage` и смонтированная ею же `DevCard` принимают одну и ту же
 * тройку `dev`/`order`/`departments` и считали из неё ОДНО И ТО ЖЕ дважды
 * за рендер: открыта ли закупка заказа, есть ли у позиции нанесения, готовы ли
 * лекала, состояния шагов, текущая колонка, материальный гейт. Сама страница
 * при этом звала `openSupplyStages` и `devBrandingFromPrints` по два раза
 * внутри себя.
 *
 * ПОЧЕМУ ЭТО ДОЛГ, А НЕ КОСМЕТИКА. Две копии отвечают на один вопрос и разойтись
 * могут молча — обе «работают», просто по-разному. Так и вышло: формула «общий
 * цех ещё не закрыл нанесения» на странице проверяла только `!== 'done'`,
 * а на доске — ещё и `!== 'cancelled'` (дословно как серверный автопереход
 * `erp_dev_branding_advance`). Отменённая задача нанесения делала карточку
 * невыпускаемой из «Нанесений» на её собственной странице и выпускаемой
 * на доске — один образец, один вопрос, два ответа.
 *
 * ПОЧЕМУ ФУНКЦИЯ, А НЕ ХУК. Первая редакция была хуком `useDevContext` —
 * и `react-hooks/rules-of-hooks` справедливо её отклонил: `DevPage` до этого
 * места делает четыре ранних возврата (отказ загрузки, скелетон, «не найдена»),
 * то есть хук вызывался бы условно. Расчёт ничего не хранит и в стор не ходит:
 * это чистая производная от данных, и место ей в `utils`, а не в `hooks`.
 * Мемоизации нет намеренно — обходы короткие, а до 05.09 страница считала
 * то же самое вообще без неё.
 *
 * ДОСКА СЮДА НЕ ПЕРЕВОДИТСЯ. В `Experimental.jsx` те же величины считаются
 * пачкой на десятки разработок (`Map` по заказу и позиции), а материальный
 * гейт спрашивается с `patternsDone: true` — это ДРУГОЙ вопрос («держат ли
 * МАТЕРИАЛЫ», без лекальной половины). Общее у доски и карточки — формулы,
 * и они уже лежат в `utils/experimentalBoard`.
 */
/**
 * СТРУКТУРНЫЕ ТИПЫ, А НЕ СТРОКИ СХЕМЫ. Оба вызывающих — `.jsx`, и заказ
 * приезжает к ним ЭМБЕДОМ (`items`, `materials`, `prints`), которого в строке
 * `ErpOrder` нет вовсе. Тем же приёмом типизирован `OrderLike`
 * в `utils/supply`: функция описывает, что ей нужно, а не откуда это взялось.
 */
type DevTaskLike = DevBoardInput['tasks'][number];

/** Строка разработки с эмбедом задач — ровно то, что просит `devStageStates` */
type DevLike = DevBoardInput['dev'] & { tasks?: readonly DevTaskLike[] | null };

interface OrderLike {
  items?: { id?: string; stages?: ErpItemStage[]; prints?: unknown }[];
  materials?: ErpMaterial[];
}

export interface DevContext {
  /** Задачи разработки (пустой массив, а не `undefined`) */
  tasks: readonly DevTaskLike[];
  /** У заказа ещё открыт этап закупки */
  supplyOpen: boolean;
  /** У позиции есть нанесения — от этого зависит, обязателен ли шаг */
  hasBranding: boolean;
  /** Лекала заведены И все закрыты */
  patternsDone: boolean;
  stageStates: DevStageState[];
  /** Колонка доски: ручная, если технолог её ставил, иначе расчётная */
  stage: DevStage;
  materialGate: ReturnType<typeof cuttingGate>;
  /** Обратная сторона гейта: её спрашивают диалоги переноса */
  materialsPending: boolean;
  /** Общий цех ещё не закрыл нанесения */
  brandingOpen: boolean;
}

export function devContext(
  dev: DevLike,
  order: OrderLike | null | undefined,
  departments: readonly { code: string; id?: string }[] | null | undefined,
): DevContext {
  const tasks = dev.tasks ?? [];
  const materials = order?.materials ?? [];
  const supplyOpen = openSupplyStages(order, findSupplyDept(departments)?.id).length > 0;
  const hasBranding = devBrandingFromPrints(
    (order?.items ?? []).find((it) => it.id === dev.item_id)?.prints as
      Parameters<typeof devBrandingFromPrints>[0],
  ).length > 0;

  /**
   * ЛЕКАЛА ГОТОВЫ — «задача типа `patterns` есть И все такие закрыты».
   * Половина `some` обязательна: `every` на пустом массиве истинно, и без неё
   * разработка, у которой лекал ещё не заводили, считалась бы прошедшей их.
   */
  const patternsDone = tasks.some((t) => t.task_type === 'patterns')
    && tasks.filter((t) => t.task_type === 'patterns')
      .every((t) => t.status === 'done' || t.status === 'cancelled');

  const stageStates = devStageStates({
    dev, tasks, materials, supplyOpen, hasBranding,
  });
  const materialGate = cuttingGate({
    patternsDone, itemId: dev.item_id, materials, supplyOpen,
  });

  return {
    tasks,
    supplyOpen,
    hasBranding,
    patternsDone,
    stageStates,
    stage: devBoardColumn(stageStates, dev),
    materialGate,
    materialsPending: !materialGate.open,
    brandingOpen: devBrandingOpen(tasks),
  };
}
