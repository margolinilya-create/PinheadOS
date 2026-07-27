import { describe, it, expect } from 'vitest';
import { kanbanDropIntent, ALLOWED_LANE_DROP } from './kanbanDrop';

const base = {
  draggedDeptId: 'sew',
  draggedGroup: 'ready',
  targetDeptId: 'sew',
  targetLane: 'in_progress',
  hasInsertPoint: false,
};

describe('kanbanDropIntent', () => {
  it('чужой цех — перенос, какая бы дорожка ни была под курсором', () => {
    for (const targetLane of ['ready', 'in_progress', 'done']) {
      expect(kanbanDropIntent({ ...base, targetDeptId: 'dtf', targetLane })).toBe('transfer');
    }
  });

  it('чужой цех — перенос даже если есть место вставки', () => {
    // Регрессия: дорожка чужой колонки не должна забирать бросок себе —
    // именно это ломало перенос между цехами на всей площади колонки.
    expect(kanbanDropIntent({
      ...base, targetDeptId: 'dtf', hasInsertPoint: true,
    })).toBe('transfer');
  });

  it('свой цех + место вставки — приоритет', () => {
    expect(kanbanDropIntent({ ...base, hasInsertPoint: true })).toBe('reorder');
  });

  it('приоритет важнее смены статуса: место вставки выигрывает', () => {
    expect(kanbanDropIntent({
      ...base, draggedGroup: 'ready', targetLane: 'in_progress', hasInsertPoint: true,
    })).toBe('reorder');
  });

  it('свой цех, разрешённый переход — смена статуса', () => {
    expect(kanbanDropIntent({ ...base, draggedGroup: 'ready', targetLane: 'in_progress' }))
      .toBe('status');
    expect(kanbanDropIntent({ ...base, draggedGroup: 'in_progress', targetLane: 'done' }))
      .toBe('status');
  });

  it('свой цех, запрещённый переход — ничего', () => {
    // Через дорожку нельзя перепрыгнуть «готов → завершено» и откатиться назад
    expect(kanbanDropIntent({ ...base, draggedGroup: 'ready', targetLane: 'done' })).toBe('none');
    expect(kanbanDropIntent({ ...base, draggedGroup: 'done', targetLane: 'ready' })).toBe('none');
    expect(kanbanDropIntent({ ...base, draggedGroup: 'in_progress', targetLane: 'ready' }))
      .toBe('none');
  });

  it('заблокированная карточка никуда не переходит по статусу', () => {
    expect(kanbanDropIntent({ ...base, draggedGroup: 'blocked', targetLane: 'in_progress' }))
      .toBe('none');
  });

  it('бросок на свою же дорожку без места вставки — ничего', () => {
    expect(kanbanDropIntent({ ...base, draggedGroup: 'ready', targetLane: 'ready' })).toBe('none');
  });

  it('карта переходов не даёт вернуться назад', () => {
    expect(ALLOWED_LANE_DROP.done).toBeUndefined();
    expect(ALLOWED_LANE_DROP.ready).toEqual(['in_progress']);
    expect(ALLOWED_LANE_DROP.in_progress).toEqual(['done']);
  });
});
