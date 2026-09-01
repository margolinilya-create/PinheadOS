import { describe, expect, it } from 'vitest';
import { DEV_OWN_STAGE_DEPT, devOwnStageToClose, devStageRemainder } from './devOwnStage';
import type { ErpItemStage } from '../types';

/**
 * Собственные этапы ЭКС закрываются переносом карточки (правка 01.09, вторая
 * итерация, п. 3): «технолог вручную переносит карточку вперёд, система
 * автоматически считает предыдущий собственный этап завершённым».
 */

const DEPTS = [
  { id: 'd-cut', code: 'cutting' },
  { id: 'd-sew', code: 'sewing' },
  { id: 'd-emb', code: 'embroidery' },
];

const stage = (over: Partial<ErpItemStage> = {}): ErpItemStage => ({
  id: 's1', item_id: 'i1', department_id: 'd-cut', status: 'waiting',
  depends_on: [], sort_order: 10, cycle: 0, qty_done: 0, qty_rework: 0,
  origin: 'production', created_at: '', updated_at: '', ...over,
} as ErpItemStage);

describe('какой этап закрывать', () => {
  it('крой закрывает этап закройного цеха', () => {
    const found = devOwnStageToClose({
      from: 'cutting', departments: DEPTS, stages: [stage({ id: 'a' })],
    });
    expect(found?.id).toBe('a');
  });

  it('пошив закрывает этап швейки', () => {
    const found = devOwnStageToClose({
      from: 'sewing',
      departments: DEPTS,
      stages: [stage({ id: 'a' }), stage({ id: 'b', department_id: 'd-sew' })],
    });
    expect(found?.id).toBe('b');
  });

  /**
   * ГЛАВНЫЙ СТОРОЖ ЭТОГО МОДУЛЯ. Нанесения делает ОБЩИЙ ЦЕХ, и закрой мы их
   * здесь — сами обошли бы собственный запрет п. 1, объявив сделанным то,
   * чего цех не делал.
   */
  it('НАНЕСЕНИЯ не закрываются никогда — их закрывает цех', () => {
    expect(DEV_OWN_STAGE_DEPT.branding).toBeUndefined();
    expect(devOwnStageToClose({
      from: 'branding',
      departments: DEPTS,
      stages: [stage({ id: 'e', department_id: 'd-emb' })],
    })).toBeNull();
  });

  it('у шагов без этапа закрывать нечего', () => {
    for (const from of ['patterns', 'materials', 'final'] as const) {
      expect(devOwnStageToClose({ from, departments: DEPTS, stages: [stage()] }), from)
        .toBeNull();
    }
  });

  it('закрытый этап не берётся — повторный перенос его не трогает', () => {
    expect(devOwnStageToClose({
      from: 'cutting', departments: DEPTS, stages: [stage({ status: 'done' })],
    })).toBeNull();
    expect(devOwnStageToClose({
      from: 'cutting', departments: DEPTS, stages: [stage({ status: 'skipped' })],
    })).toBeNull();
  });

  it('из нескольких заходов берётся текущий, а не первый попавшийся', () => {
    // Доработка: позиция ходит в один цех несколько раз, и закрыть надо тот
    // заход, который идёт сейчас
    const found = devOwnStageToClose({
      from: 'cutting',
      departments: DEPTS,
      stages: [
        stage({ id: 'c1', cycle: 1, status: 'ready' }),
        stage({ id: 'c0', cycle: 0, status: 'done' }),
      ],
    });
    expect(found?.id).toBe('c1');
  });

  it('цеха нет в справочнике — не падаем', () => {
    expect(devOwnStageToClose({ from: 'cutting', departments: [], stages: [stage()] }))
      .toBeNull();
  });
});

describe('остаток до полного тиража', () => {
  it('приращение, а не абсолют', () => {
    expect(devStageRemainder(stage({ qty_done: 3 }), 5)).toBe(2);
  });

  it('тираж добран — дописывать нечего', () => {
    expect(devStageRemainder(stage({ qty_done: 5 }), 5)).toBe(0);
    expect(devStageRemainder(stage({ qty_done: 7 }), 5)).toBe(0);
  });

  it('тираж неизвестен — ничего не пишем', () => {
    // Ноль в знаменателе это «неизвестно», а не «готово» (правило проекта)
    expect(devStageRemainder(stage(), 0)).toBe(0);
    expect(devStageRemainder(stage(), null)).toBe(0);
  });
});
