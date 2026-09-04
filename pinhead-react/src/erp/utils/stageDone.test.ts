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

  it('«Доступен со склада» и «Не требуется» не блокируют', () => {
    // Решение заказчика: буквальное «любой статус кроме Пришло/Доступен»
    // включило бы `not_needed`, и заказ с такой строкой не закрылся бы никогда
    for (const status of ['reserved', 'not_needed'] as MaterialStatus[]) {
      expect(stageCompletionBlock({
        stage: { id: 's-cut', qty_done: 100 }, qty: 100, allStages: stages,
        materials: [mat({ status })], dept: cut,
      })).toBeNull();
    }
  });

  /**
   * «ПРИШЛО» ГОДИТСЯ ТОЛЬКО С ПРИЁМКОЙ (обход 04.09). `erp_material_accept`
   * ставит `received` при ЛЮБОМ исходе — и при недостаче, и при отказе, —
   * поэтому проверка по одному статусу закрывала этап на материале, который
   * тот же цех не смог бы ВЗЯТЬ в работу: гейт запуска вердикт спрашивает
   * с 22.07. На боевой базе так закрылся закрой заказа 60448 — целиком,
   * при трёх непринятых позициях.
   */
  it('«Пришло» блокирует, пока склад не оформил приёмку', () => {
    const block = (accept: string | null) => stageCompletionBlock({
      stage: { id: 's-cut', qty_done: 100 }, qty: 100, allStages: stages,
      materials: [mat({ status: 'received', accept_status: accept } as never)], dept: cut,
    });
    expect(block('accepted_full')).toBeNull();
    expect(block('accepted_partial')).toBeNull();
    for (const bad of ['shortage', 'mismatch', 'rejected', null]) {
      expect(block(bad)).toContain('Закупка не завершена');
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
 * Сторож на ВЫЗЫВАЮЩИХ ДИАЛОГА. `materials`/`dept` объявлены обязательными,
 * но все точки живут в .jsx/.js — тайпчек там аргументы не проверяет.
 *
 * ЧЕМ ОН БЫЛ ДО 03.09. Список путей вёлся РУКАМИ, и в нём было три строки
 * при четырёх путях закрытия:
 * «Записать результат» у участка со схемой отчёта шёл в `submitStageReport`
 * мимо всего. Само правило теперь живёт у писателей
 * (`stagesSlice.completionBlockFor`), и сторожит его `store/stageCompletionGate.test.ts`
 * ПОВЕДЕНИЕМ — снимите проверку у любого писателя, и он краснеет; пятый путь
 * пройдёт через тех же писателей и вписывать его никуда не нужно.
 *
 * Здесь остаётся проверка ТЕКСТА диалога: он объясняет человеку последствия
 * до действия, и аргументы ему нужны те же самые.
 */
describe('confirmStageDone — гейт подключён во всех точках закрытия', () => {
  it('каждая точка передаёт материалы позиции и цех этапа', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const erpRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

    /**
     * Вызывающие ИЩУТСЯ, а не перечисляются. Список из трёх путей пришлось бы
     * пополнять руками — а сторож, который надо не забыть пополнить, забывают
     * пополнить: ровно так «Записать результат» четвёртым путём прошёл мимо
     * гейта. Ищем сам вызов по всем исходникам раздела.
     */
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(p);
      }
      return out;
    };
    const callers = walk(erpRoot).filter(
      (f) => readFileSync(f, 'utf8').includes('confirmStageDone({'),
    );
    expect(callers.length, 'вызовов confirmStageDone не найдено — сторож сторожит пустоту')
      .toBeGreaterThanOrEqual(3);

    for (const file of callers) {
      const rel = file.slice(erpRoot.length + 1);
      const src = readFileSync(file, 'utf8');
      const call = src.slice(src.indexOf('confirmStageDone({'));
      const body = call.slice(0, call.indexOf('});'));
      expect(body, `${rel}: не передаёт materials`).toContain('materials:');
      expect(body, `${rel}: не передаёт dept`).toContain('dept:');
      // именно материалы ПОЗИЦИИ, а не весь заказ: иначе гейт считал бы
      // чужие строки закупки
      expect(body, `${rel}: материалы не отобраны по позиции`).toContain('materialsForItem(');
      /**
       * Аварийное снятие учитывается и в ДИАЛОГЕ (правка 03.09). Писатель его
       * уважает; если диалог не будет — он откажет раньше, и человек увидит
       * отказ там, где система уже разрешила. Половина выхода — не выход.
       */
      expect(body, `${rel}: не учитывает аварийное снятие`).toContain('materialsAfterBypass(');
    }
  });
});
