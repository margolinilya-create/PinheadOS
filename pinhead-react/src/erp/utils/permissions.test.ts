import { describe, it, expect } from 'vitest';
import { DEFAULT_PERMISSIONS, canActInDept, isAllowed, resolveErpRole } from './permissions';
import type { PermissionMatrix } from './permissions';

describe('resolveErpRole', () => {
  it('admin и director всегда director, даже с цеховой ролью worker', () => {
    expect(resolveErpRole('admin', 'worker')).toBe('director');
    expect(resolveErpRole('director', 'hr')).toBe('director');
  });

  it('цеховая роль побеждает роль профиля для рядовых', () => {
    expect(resolveErpRole('production', 'foreman')).toBe('foreman');
    expect(resolveErpRole('manager', 'purchaser')).toBe('purchaser');
  });

  it('без цеховой роли — маппинг роли профиля', () => {
    expect(resolveErpRole('rop', null)).toBe('dispatcher');
    expect(resolveErpRole('manager', null)).toBe('manager');
    expect(resolveErpRole('production', null)).toBe('worker');
    expect(resolveErpRole('designer', null)).toBe('worker');
  });

  it('неизвестная роль и отсутствие роли — worker', () => {
    expect(resolveErpRole('kto-to', null)).toBe('worker');
    expect(resolveErpRole(undefined, undefined)).toBe('worker');
  });
});

describe('isAllowed', () => {
  const matrix: PermissionMatrix = {
    worker: { 'stage.take': true, 'stage.priority': false },
    foreman: { 'stage.priority': true },
  };

  it('берёт значение из матрицы БД', () => {
    expect(isAllowed(matrix, 'worker', 'stage.take')).toBe(true);
    expect(isAllowed(matrix, 'worker', 'stage.priority')).toBe(false);
    expect(isAllowed(matrix, 'foreman', 'stage.priority')).toBe(true);
  });

  it('права нет в матрице — падает на дефолт роли', () => {
    // worker по дефолту завершает этап, но не переносит между цехами
    expect(isAllowed(matrix, 'worker', 'stage.complete')).toBe(true);
    expect(isAllowed(matrix, 'worker', 'stage.move_department')).toBe(false);
  });

  it('матрица не загружена — работают дефолты', () => {
    expect(isAllowed(null, 'director', 'catalog.edit')).toBe(true);
    expect(isAllowed(undefined, 'hr', 'stage.take')).toBe(false);
    expect(isAllowed(null, 'dispatcher', 'stage.move_department')).toBe(true);
    expect(isAllowed(null, 'dispatcher', 'catalog.edit')).toBe(false);
  });

  it('матрица БД может отобрать право, разрешённое дефолтом', () => {
    expect(isAllowed({ worker: { 'stage.complete': false } }, 'worker', 'stage.complete')).toBe(false);
  });

  it('дефолты: приоритеты — не для рядового сотрудника цеха', () => {
    expect(DEFAULT_PERMISSIONS.worker).not.toContain('stage.priority');
    expect(DEFAULT_PERMISSIONS.foreman).toContain('stage.priority');
  });

  // Фолбэк обязан повторять seed миграций: иначе при неудачной загрузке матрицы
  // роль молча теряет право и человек не понимает почему.
  it('дефолты повторяют seed: tz.manage у руководства, диспетчера и менеджера', () => {
    for (const role of ['director', 'dispatcher', 'manager'] as const) {
      expect(DEFAULT_PERMISSIONS[role]).toContain('tz.manage');
    }
    for (const role of ['foreman', 'worker', 'purchaser', 'storekeeper', 'hr'] as const) {
      expect(DEFAULT_PERMISSIONS[role]).not.toContain('tz.manage');
    }
  });

  it('менеджер без привязки к цеху не получает действий над этапами', () => {
    // Без записи в erp_employees canActInDept пропускает в любой цех — значит
    // единственная защита здесь матрица: у роли нет ни взятия, ни завершения, ни брака.
    for (const p of ['stage.take', 'stage.progress', 'stage.complete', 'stage.defect'] as const) {
      expect(isAllowed(null, 'manager', p)).toBe(false);
    }
    expect(isAllowed(null, 'manager', 'stage.block')).toBe(true);
  });
});

describe('canActInDept', () => {
  it('dev-режим — везде', () => {
    expect(canActInDept('production', 'd1', 'd2', true)).toBe(true);
  });

  it('руководящий состав — в любом цехе', () => {
    expect(canActInDept('admin', 'd1', 'd2')).toBe(true);
    expect(canActInDept('director', 'd1', 'd2')).toBe(true);
    expect(canActInDept('rop', 'd1', 'd2')).toBe(true);
  });

  it('привязанный сотрудник — только в своём цехе', () => {
    expect(canActInDept('production', 'd1', 'd1')).toBe(true);
    expect(canActInDept('production', 'd1', 'd2')).toBe(false);
    expect(canActInDept('production', 'd1', null)).toBe(false);
  });

  it('без привязки — в выбранном цехе (legacy-поведение)', () => {
    expect(canActInDept('production', null, 'd2')).toBe(true);
  });
});
