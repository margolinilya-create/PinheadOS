import { describe, it, expect } from 'vitest';
import { stageDoneWarning, dependentStageNames, stageCompletionBlock } from './stageDone';
import type { ErpMaterial, MaterialStatus } from '../types';

const deptNames = new Map([
  ['d-cut', 'Раскрой'],
  ['d-sew', 'Швейка'],
  ['d-vto', 'ВТО'],
]);

const stages = [
  { id: 's-cut', department_id: 'd-cut', depends_on: [] },
  { id: 's-sew', department_id: 'd-sew', depends_on: ['s-cut'] },
  { id: 's-vto', department_id: 'd-vto', depends_on: ['s-sew'] },
];

describe('stageDoneWarning', () => {
  it('весь тираж сдан — подтверждать нечего', () => {
    expect(stageDoneWarning({
      stage: { id: 's-cut', qty_done: 100 }, qty: 100, allStages: stages, deptNameById: deptNames,
    })).toBeNull();
  });

  it('сдано больше тиража (переделка) — тоже молча', () => {
    expect(stageDoneWarning({
      stage: { id: 's-cut', qty_done: 120 }, qty: 100, allStages: stages, deptNameById: deptNames,
    })).toBeNull();
  });

  it('сдана часть — называет остаток и следующий цех', () => {
    const msg = stageDoneWarning({
      stage: { id: 's-cut', qty_done: 40 }, qty: 100, allStages: stages, deptNameById: deptNames,
    });
    expect(msg).toContain('40 из 100');
    expect(msg).toContain('60 шт');
    expect(msg).toContain('Швейка');
    expect(msg).toContain('100 шт');
  });

  it('qty_done не проставлен — считается за ноль', () => {
    const msg = stageDoneWarning({
      stage: { id: 's-cut', qty_done: null }, qty: 50, allStages: stages, deptNameById: deptNames,
    });
    expect(msg).toContain('0 из 50');
    expect(msg).toContain('50 шт');
  });

  it('последний этап маршрута — про следующий цех не врёт', () => {
    const msg = stageDoneWarning({
      stage: { id: 's-vto', qty_done: 10 }, qty: 30, allStages: stages, deptNameById: deptNames,
    });
    expect(msg).toContain('20 шт');
    expect(msg).not.toContain('откроется');
  });

  it('несколько зависимых этапов перечисляются все', () => {
    const parallel = [
      { id: 's-cut', department_id: 'd-cut', depends_on: [] },
      { id: 's-dtf', department_id: 'd-dtf', depends_on: ['s-cut'] },
      { id: 's-emb', department_id: 'd-emb', depends_on: ['s-cut'] },
    ];
    const names = new Map([['d-dtf', 'ДТФ'], ['d-emb', 'Вышивка']]);
    const msg = stageDoneWarning({
      stage: { id: 's-cut', qty_done: 1 }, qty: 10, allStages: parallel, deptNameById: names,
    });
    expect(msg).toContain('ДТФ, Вышивка');
  });

  it('без карты имён — нейтральная формулировка вместо пустоты', () => {
    expect(dependentStageNames({
      stage: { id: 's-cut', qty_done: 0 }, qty: 10, allStages: stages,
    })).toEqual(['следующий этап']);
  });
});

/**
 * Гейт закупки на ЗАВЕРШЕНИИ этапа (правка заказчика 30.08, п. 5).
 *
 * До правки все гейты производства стояли на ВХОДЕ (`isStageReady`), и этап,
 * однажды взятый в работу, закрывался всегда. Закрой закрывался при
 * неприехавшей ткани и открывал следующий цех на тираж, которого физически
 * нет, — молча.
 */
describe('stageCompletionBlock — закупка держит завершение', () => {
  const cut = { gate_material_kinds: ['fabric'] };
  const vto = { gate_material_kinds: [] };
  // Фикстура режется до полей, которые читает гейт: полный `ErpMaterial` —
  // 22 поля, и заполнять их ради двух означало бы прятать проверяемое
  const mat = (over: Partial<ErpMaterial> = {}): ErpMaterial => ({
    id: 'm1', kind: 'fabric', name: 'Кулирка', status: 'ordered', ...over,
  } as ErpMaterial);

  it('незакрытая позиция закупки блокирует и НАЗЫВАЕТ себя', () => {
    const msg = stageCompletionBlock({
      stage: { id: 's-cut', qty_done: 100 }, qty: 100, allStages: stages,
      materials: [mat()], dept: cut,
    });
    // Отказ обязан перечислять позиции: кнопка, гаснущая молча, читается
    // цехом как поломка сайта
    expect(msg).toContain('Кулирка');
    expect(msg).toContain('Закупка не завершена');
  });

  it('«Пришло», «Доступен со склада» и «Не требуется» не блокируют', () => {
    // Решение заказчика: буквальное «любой статус кроме Пришло/Доступен»
    // включило бы `not_needed`, и заказ с такой строкой не закрылся бы никогда
    for (const status of ['received', 'reserved', 'not_needed'] as MaterialStatus[]) {
      expect(stageCompletionBlock({
        stage: { id: 's-cut', qty_done: 100 }, qty: 100, allStages: stages,
        materials: [mat({ status })], dept: cut,
      })).toBeNull();
    }
  });

  it('прочие статусы блокируют', () => {
    for (const status of ['pending', 'ordered', 'in_transit', 'partial'] as MaterialStatus[]) {
      expect(stageCompletionBlock({
        stage: { id: 's-cut', qty_done: 100 }, qty: 100, allStages: stages,
        materials: [mat({ status })], dept: cut,
      })).not.toBeNull();
    }
  });

  it('цех без материального гейта не гейтится вовсе (fail-open)', () => {
    // Правило проекта: участок не должен вставать из-за незаполненной настройки
    expect(stageCompletionBlock({
      stage: { id: 's-vto', qty_done: 100 }, qty: 100, allStages: stages,
      materials: [mat()], dept: vto,
    })).toBeNull();
    expect(stageCompletionBlock({
      stage: { id: 's-vto', qty_done: 100 }, qty: 100, allStages: stages,
      materials: [mat()], dept: null,
    })).toBeNull();
  });

  it('проверяются ВСЕ виды материалов, а не только виды гейта цеха', () => {
    // Документ говорит «хотя бы одна позиция закупки»: это осознанно шире
    // входного гейта, который смотрит только свои виды
    expect(stageCompletionBlock({
      stage: { id: 's-cut', qty_done: 100 }, qty: 100, allStages: stages,
      materials: [mat({ kind: 'hardware', name: 'Молния', status: 'in_transit' })], dept: cut,
    })).toContain('Молния');
  });
});

/**
 * Сторож на ВЫЗЫВАЮЩИХ. `materials`/`dept` объявлены обязательными, но все
 * три точки закрытия этапа живут в .jsx/.js — тайпчек там аргументы
 * не проверяет, и забытый вызывающий молча закрывал бы этап мимо гейта.
 * Поэтому проверяем исходники.
 */
describe('confirmStageDone — гейт подключён во всех точках закрытия', () => {
  const CALLERS = [
    'screens/queue/useStageActions.js',
    'components/ErpKanban.jsx',
    'screens/ProductionBoard.jsx',
  ];

  it('каждая точка передаёт материалы позиции и цех этапа', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const erpRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

    for (const rel of CALLERS) {
      const src = readFileSync(join(erpRoot, rel), 'utf8');
      const call = src.slice(src.indexOf('confirmStageDone({'));
      const body = call.slice(0, call.indexOf('});'));
      expect(body, `${rel}: не передаёт materials`).toContain('materials:');
      expect(body, `${rel}: не передаёт dept`).toContain('dept:');
      // именно материалы ПОЗИЦИИ, а не весь заказ: иначе гейт считал бы
      // чужие строки закупки
      expect(body, `${rel}: материалы не отобраны по позиции`).toContain('materialsForItem(');
    }
  });
});
