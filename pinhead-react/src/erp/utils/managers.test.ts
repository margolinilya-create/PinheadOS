import { describe, it, expect } from 'vitest';
import { managerOptions, MANAGER_ROLES } from './managers';
import type { ErpEmployee } from '../types';
import type { StaffProfile } from '../store/types';

function emp(patch: Partial<ErpEmployee>): ErpEmployee {
  return {
    id: patch.id ?? 'e1',
    full_name: patch.full_name ?? '',
    role: patch.role ?? 'manager',
    department_id: patch.department_id ?? null,
    extra_department_ids: patch.extra_department_ids ?? [],
    profile_id: patch.profile_id ?? null,
    notes: patch.notes ?? null,
    active: patch.active ?? true,
    created_at: patch.created_at ?? '2026-09-07T00:00:00Z',
    updated_at: patch.updated_at ?? '2026-09-07T00:00:00Z',
  } as ErpEmployee;
}

function profile(patch: Partial<StaffProfile>): StaffProfile {
  return {
    id: patch.id ?? 'p1',
    name: patch.name ?? null,
    email: patch.email ?? null,
    role: patch.role ?? 'manager',
    approved: patch.approved ?? true,
    active: patch.active ?? true,
  };
}

describe('managerOptions', () => {
  it('берёт роли, ведущие заказ, и отбрасывает цеховые', () => {
    const list = managerOptions([
      emp({ id: '1', full_name: 'Никита', role: 'manager' }),
      emp({ id: '2', full_name: 'Марголин Илья', role: 'director' }),
      emp({ id: '3', full_name: 'Мария', role: 'production_head' }),
      emp({ id: '4', full_name: 'Диспетчер Дима', role: 'dispatcher' }),
      emp({ id: '5', full_name: 'Швея Света', role: 'worker' }),
      emp({ id: '6', full_name: 'Печатник Пётр', role: 'silkscreen' }),
    ]);
    expect(list).toEqual(['Диспетчер Дима', 'Марголин Илья', 'Мария', 'Никита']);
  });

  /**
   * Ровно тот состав, что стоит на боевой базе 07.09: менеджеров сопровождения
   * там НЕТ ни одного. Список, построенный строго по роли `manager`, был бы
   * пустым — и поле «Менеджер» стало бы незаполнимым.
   */
  it('на боевом составе (директор + руководители производства) список не пуст', () => {
    const list = managerOptions([
      emp({ id: '1', full_name: 'Марголин Илья', role: 'director' }),
      emp({ id: '2', full_name: 'Иванова Марийка', role: 'production_head' }),
      emp({ id: '3', full_name: 'Маргарита', role: 'production_head' }),
      emp({ id: '4', full_name: 'Мария', role: 'production_head' }),
    ]);
    expect(list).toHaveLength(4);
    expect(list).toContain('Мария');
  });

  it('отключённый сотрудник не предлагается', () => {
    const list = managerOptions([
      emp({ id: '1', full_name: 'Активный', role: 'manager', active: true }),
      emp({ id: '2', full_name: 'Уволенный', role: 'manager', active: false }),
    ]);
    expect(list).toEqual(['Активный']);
  });

  it('пустое full_name достраивается из профиля', () => {
    const list = managerOptions(
      [emp({ id: '1', full_name: '', role: 'manager', profile_id: 'p7' })],
      [profile({ id: 'p7', name: 'Глазков Артем' })],
    );
    expect(list).toEqual(['Глазков Артем']);
  });

  it('без имени вовсе сотрудник в список не попадает — почта именем не является', () => {
    const list = managerOptions(
      [emp({ id: '1', full_name: '', role: 'manager', profile_id: 'p7' })],
      [profile({ id: 'p7', name: null, email: 'za@pnhd.ru' })],
    );
    expect(list).toEqual([]);
  });

  it('тёзки не дублируются', () => {
    const list = managerOptions([
      emp({ id: '1', full_name: 'Мария', role: 'manager' }),
      emp({ id: '2', full_name: 'мария', role: 'production_head' }),
    ]);
    expect(list).toEqual(['Мария']);
  });

  it('пустой ввод не роняет', () => {
    expect(managerOptions()).toEqual([]);
    expect(managerOptions([], [])).toEqual([]);
  });

  it('перечень ролей закрытый и назван поимённо', () => {
    expect(MANAGER_ROLES).toEqual(['manager', 'director', 'production_head', 'dispatcher']);
  });
});
