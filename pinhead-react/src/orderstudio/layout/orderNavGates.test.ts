import { describe, it, expect } from 'vitest';
import {
  canFinish, canLaunch, canReturn, canSeeLaunchQueue, canSendToWork, canSetPayment, canSetPaymentOverride,
  isMs, isProductionBoss,
} from './orderNav';
import type { GateOrder, SalesProfile } from './orderNav';
import type { SalesOrderStatus } from '../model/types';

/**
 * Гейты отправки, оплаты и запуска (веха 6+7) — зеркало миграции J.
 * Таблица «профиль × статус × автор» на каждую функцию: ожидание выписано
 * рукой, а не вычислено той же формулой, что в коде.
 */
const ME = 'u-me';
const live = { active: true, approved: true };

const P: Record<string, SalesProfile> = {
  admin: { id: ME, role: 'admin', ...live },
  director: { id: ME, role: 'director', ...live },
  rop: { id: ME, role: 'rop', ...live },
  /** продавец с ролью production — автор по признаку (К20) */
  seller: { id: ME, role: 'production', is_sales: true, ...live },
  /** manager без is_sales — больше не автор */
  manager: { id: ME, role: 'manager', ...live },
  ms: { id: ME, role: 'manager', is_ms: true, ...live },
  /** rop с признаком МС */
  ropMs: { id: ME, role: 'rop', is_ms: true, ...live },
  msOff: { id: ME, role: 'manager', is_ms: true, active: false, approved: true },
  adminPending: { id: ME, role: 'admin', active: true, approved: false },
};

const own = (status: SalesOrderStatus): GateOrder => ({ status, created_by: ME });
const other = (status: SalesOrderStatus): GateOrder => ({ status, created_by: 'u-other' });

type Row = [keyof typeof P, GateOrder, boolean];

describe('canSendToWork — черновик, автор по is_sales или руководство продаж', () => {
  it.each<Row>([
    ['seller', own('draft'), true],
    ['seller', other('draft'), false],
    ['seller', own('ready_to_launch'), false],
    ['manager', own('draft'), false],
    ['rop', other('draft'), true],
    ['admin', other('draft'), true],
    ['director', other('draft'), true],
    ['ms', other('draft'), false],
    ['ms', own('draft'), false],
    ['adminPending', other('draft'), false],
  ])('%s %o → %s', (who, order, expected) => {
    expect(canSendToWork(P[who], order)).toBe(expected);
  });
});

describe('canSetPayment — автор и lead в draft|ready, МС только ready и не свой', () => {
  it.each<Row>([
    ['seller', own('draft'), true],
    ['seller', own('ready_to_launch'), true],
    ['seller', own('production'), false],
    ['seller', other('draft'), false],
    ['manager', own('draft'), false],
    ['rop', other('draft'), true],
    ['rop', other('ready_to_launch'), true],
    ['admin', other('production'), false],
    ['ms', other('ready_to_launch'), true],
    ['ms', other('draft'), false],
    ['ms', own('ready_to_launch'), false],
    ['ms', other('production'), false],
    ['msOff', other('ready_to_launch'), false],
  ])('%s %o → %s', (who, order, expected) => {
    expect(canSetPayment(P[who], order)).toBe(expected);
  });
});

describe('canSetPaymentOverride — только руководство продаж', () => {
  it.each<[keyof typeof P, boolean]>([
    ['admin', true], ['director', true], ['rop', true],
    ['seller', false], ['ms', false], ['manager', false], ['adminPending', false],
  ])('%s → %s', (who, expected) => {
    expect(canSetPaymentOverride(P[who])).toBe(expected);
  });
});

describe('canLaunch и canReturn — ready_to_launch, МС или admin/director; rop — нет (К17)', () => {
  it.each<Row>([
    ['ms', other('ready_to_launch'), true],
    ['ms', own('ready_to_launch'), true],
    ['admin', other('ready_to_launch'), true],
    ['director', other('ready_to_launch'), true],
    ['rop', other('ready_to_launch'), false],
    ['ropMs', other('ready_to_launch'), true],
    ['seller', own('ready_to_launch'), false],
    ['ms', other('draft'), false],
    ['ms', other('production'), false],
    ['msOff', other('ready_to_launch'), false],
  ])('%s %o → %s', (who, order, expected) => {
    expect(canLaunch(P[who], order)).toBe(expected);
    expect(canReturn(P[who], order)).toBe(expected);
  });
});

describe('canFinish — production, МС или admin/director', () => {
  it.each<Row>([
    ['ms', other('production'), true],
    ['admin', other('production'), true],
    ['director', other('production'), true],
    ['rop', other('production'), false],
    ['seller', own('production'), false],
    ['ms', other('ready_to_launch'), false],
    ['ms', other('done'), false],
  ])('%s %o → %s', (who, order, expected) => {
    expect(canFinish(P[who], order)).toBe(expected);
  });
});

describe('canSeeLaunchQueue, isMs, isProductionBoss', () => {
  it.each<[keyof typeof P, boolean, boolean, boolean]>([
    ['ms', true, true, false],
    ['ropMs', true, true, false],
    ['admin', true, false, true],
    ['director', true, false, true],
    ['rop', false, false, false],
    ['seller', false, false, false],
    ['msOff', false, false, false],
    ['adminPending', false, false, false],
  ])('%s → очередь %s, МС %s, boss %s', (who, queue, ms, boss) => {
    expect(canSeeLaunchQueue(P[who])).toBe(queue);
    expect(isMs(P[who])).toBe(ms);
    expect(isProductionBoss(P[who])).toBe(boss);
  });

  it('нет профиля — нигде', () => {
    expect(canSeeLaunchQueue(null)).toBe(false);
    expect(canLaunch(undefined, other('ready_to_launch'))).toBe(false);
    expect(canSetPayment(null, other('draft'))).toBe(false);
  });

  it('профиль без id не автор, даже если у заказа автора нет', () => {
    const noId: SalesProfile = { role: 'production', is_sales: true, ...live };
    expect(canSendToWork(noId, { status: 'draft', created_by: null })).toBe(false);
    expect(canSetPayment({ role: 'manager', is_ms: true, ...live }, { status: 'ready_to_launch', created_by: null })).toBe(false);
  });
});
