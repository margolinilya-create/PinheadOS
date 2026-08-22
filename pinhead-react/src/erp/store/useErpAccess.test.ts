/**
 * Хуки прав: `useErpAccess` и `useStagePermissions`.
 *
 * Вокруг них матрица сторожится очень плотно — `permissions.test.ts`,
 * `permissionsCoverage.test.ts`, `serverPermissions.test.ts`, `screenAccess.test.ts`.
 * А сами хуки, ПРИМЕНЯЮЩИЕ эти правила к кнопкам, до 22.08 не были покрыты
 * ничем. Разрыв ровно того вида, на котором проект уже ловился: правила
 * проверены, применение — нет.
 *
 * Проверяется поведение на границах, где ошибка стоит дороже всего:
 * dev-режим, приведение роли профиля, привязка к участку и то, что каждое
 * действие цеха гейтится СВОИМ правом, а не одним «мой ли это цех».
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useErpAccess } from './useErpAccess';
import { useStagePermissions } from './useStagePermissions';
import { useErpStore, resetErpStore } from './useErpStore';

vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ user: currentUser }),
    { getState: () => ({ user: currentUser }) },
  ),
}));

let currentUser: { id: string; role: string; name?: string } | null = null;

const DEPT_MINE = 'd-warehouse';
const DEPT_OTHER = 'd-sewing';

/** Матрица из БД: то, что реально решает, а не дефолты */
const MATRIX = {
  storekeeper: { 'warehouse.manage': true, 'material.receive': true, 'stage.block': true },
  worker: {
    'stage.take': true, 'stage.progress': true, 'stage.complete': true,
    'stage.block': true, 'stage.defect': true,
  },
  director: {
    'stage.take': true, 'stage.progress': true, 'stage.complete': true,
    'stage.block': true, 'stage.defect': true, 'order.manage': true, 'plan.manage': true,
  },
};

function setup(user: typeof currentUser, myRole: string | null, myDeptId: string | null) {
  currentUser = user;
  useErpStore.setState({ myRole, myDeptId, permissionMatrix: MATRIX } as never);
}

describe('useErpAccess', () => {
  beforeEach(() => {
    resetErpStore();
    currentUser = null;
  });

  it('dev-режим открывает всё и не требует привязки', () => {
    setup({ id: 'dev', role: 'production' }, 'worker', null);
    const { result } = renderHook(() => useErpAccess());

    expect(result.current.can('order.manage')).toBe(true);
    expect(result.current.canActIn(DEPT_OTHER)).toBe(true);
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.needsDeptBinding).toBe(false);
  });

  it('роль профиля admin приводится к цеховой director', () => {
    setup({ id: 'u1', role: 'admin' }, 'worker', DEPT_MINE);
    const { result } = renderHook(() => useErpAccess());

    // Руководство не теряет доступ из-за того, что ему проставили роль рабочего
    expect(result.current.role).toBe('director');
    expect(result.current.can('order.manage')).toBe(true);
  });

  /**
   * `isAdmin` — зеркало серверной `is_admin()` (только `profiles.role = 'admin'`),
   * `isPrivileged` шире (плюс director и РОП). Их уже путали, и на этом
   * расхождении стояла кнопка удаления заказа.
   */
  it('isAdmin уже, чем isPrivileged', () => {
    setup({ id: 'u1', role: 'director' }, null, null);
    const { result } = renderHook(() => useErpAccess());

    expect(result.current.isPrivileged).toBe(true);
    expect(result.current.isAdmin).toBe(false);
  });

  it('привязанный сотрудник действует только в своём участке', () => {
    setup({ id: 'u1', role: 'production' }, 'storekeeper', DEPT_MINE);
    const { result } = renderHook(() => useErpAccess());

    expect(result.current.canActIn(DEPT_MINE)).toBe(true);
    expect(result.current.canActIn(DEPT_OTHER)).toBe(false);
    expect(result.current.needsDeptBinding).toBe(false);
  });

  /**
   * До 22.08 здесь был безусловный пропуск, и кладовщик без привязки работал
   * на всей фабрике: матрица его не держит — `warehouse.manage` и `stage.block`
   * у роли есть.
   */
  it('роль участка без привязки не действует нигде и говорит об этом', () => {
    setup({ id: 'u1', role: 'production' }, 'storekeeper', null);
    const { result } = renderHook(() => useErpAccess());

    expect(result.current.can('warehouse.manage')).toBe(true);   // право есть
    expect(result.current.canActIn(DEPT_MINE)).toBe(false);      // а участка нет
    expect(result.current.needsDeptBinding).toBe(true);
  });

  it('сквозная роль без привязки работает везде', () => {
    setup({ id: 'u1', role: 'manager' }, 'manager', null);
    const { result } = renderHook(() => useErpAccess());

    expect(result.current.canActIn(DEPT_OTHER)).toBe(true);
    expect(result.current.needsDeptBinding).toBe(false);
  });

  it('canDo — это право И участок вместе', () => {
    setup({ id: 'u1', role: 'production' }, 'worker', DEPT_MINE);
    const { result } = renderHook(() => useErpAccess());

    expect(result.current.canDo('stage.take', DEPT_MINE)).toBe(true);
    // право есть, участок чужой
    expect(result.current.canDo('stage.take', DEPT_OTHER)).toBe(false);
    // участок свой, права нет
    expect(result.current.canDo('order.manage', DEPT_MINE)).toBe(false);
  });

  it('матрица БД важнее дефолтов роли', () => {
    setup({ id: 'u1', role: 'production' }, 'worker', DEPT_MINE);
    useErpStore.setState({
      permissionMatrix: { ...MATRIX, worker: { 'stage.complete': false } },
    } as never);
    const { result } = renderHook(() => useErpAccess());

    expect(result.current.can('stage.complete')).toBe(false);
  });
});

describe('useStagePermissions', () => {
  beforeEach(() => {
    resetErpStore();
    currentUser = null;
  });

  it('каждое действие цеха гейтится своим правом', () => {
    setup({ id: 'u1', role: 'production' }, 'storekeeper', DEPT_MINE);
    const { result } = renderHook(() => useStagePermissions(DEPT_MINE));

    // У кладовщика из цеховых прав только блокировка
    expect(result.current.block).toBe(true);
    expect(result.current.take).toBe(false);
    expect(result.current.complete).toBe(false);
    expect(result.current.defect).toBe(false);
  });

  it('чужой участок закрывает все действия по этапу', () => {
    setup({ id: 'u1', role: 'production' }, 'worker', DEPT_MINE);
    const { result } = renderHook(() => useStagePermissions(DEPT_OTHER));

    expect(result.current.take).toBe(false);
    expect(result.current.complete).toBe(false);
    expect(result.current.inDept).toBe(false);
  });

  /**
   * Пропуск этапа и постановка в план — решения по МАРШРУТУ и по расписанию,
   * а не работа цеха: участок вызывающего в них не проверяется, потому что
   * ни тот, ни другой не в цехе.
   */
  it('пропуск этапа и план участком не гейтятся', () => {
    setup({ id: 'u1', role: 'director' }, 'director', DEPT_MINE);
    const { result } = renderHook(() => useStagePermissions(DEPT_OTHER));

    expect(result.current.skip).toBe(true);
    expect(result.current.plan).toBe(true);
  });

  it('any — хоть одно действие доступно', () => {
    setup({ id: 'u1', role: 'production' }, 'worker', DEPT_MINE);
    expect(renderHook(() => useStagePermissions(DEPT_MINE)).result.current.any).toBe(true);

    setup({ id: 'u2', role: 'production' }, 'hr', DEPT_MINE);
    expect(renderHook(() => useStagePermissions(DEPT_MINE)).result.current.any).toBe(false);
  });

  /**
   * Причина пустого блока действий обязана доезжать до экрана задания:
   * иначе цех видит задание без единой кнопки и читает это как поломку.
   */
  it('непривязанный профиль пробрасывает причину на страницу задания', () => {
    setup({ id: 'u1', role: 'production' }, 'worker', null);
    const { result } = renderHook(() => useStagePermissions(DEPT_MINE));

    expect(result.current.needsDeptBinding).toBe(true);
    expect(result.current.take).toBe(false);
  });
});
