/**
 * ВКЛАДКА «ПОЛЬЗОВАТЕЛИ» НЕ ВРЁТ ТОМУ, КТО НЕ АДМИН.
 *
 * ЧТО БЫЛО. Раздел `/admin` открыт ролям `admin` и `director`, а у вкладки
 * гейта не было вовсе. При этом три политики на сервере стоят на `is_admin()`,
 * а эта функция требует роль профиля РОВНО `admin`:
 *
 *   · `profiles_select` — `auth.uid() = id OR is_admin()`. Директор получал
 *     список из ОДНОЙ строки, своей собственной. Ни ошибки, ни признака, что
 *     список урезан: RLS не сообщает о скрытых строках, он их не отдаёт.
 *     «Пять сотрудников» превращались в «один», и это выглядело как правда;
 *   · `profiles_update` и `erp_employees_update` — подтверждение доступа,
 *     отключение, смена роли и привязка к цеху отвечали УСПЕХОМ, ничего
 *     не изменив: RLS на UPDATE запрещает через `USING`, то есть отдаёт
 *     «0 строк», а не ошибку.
 *
 * Директор нажимал «Подтвердить» новому сотруднику, видел, что тот
 * подтверждён, — а человек продолжал стоять на стене «ждите одобрения».
 * Причину не узнавал ни один из двоих.
 *
 * ПРАВА ЗДЕСЬ НЕ РАСШИРЕНЫ. Интерфейс приведён к серверу, а не наоборот:
 * если заказчик решит, что учётные записи ведёт и директор, правильная
 * правка — перевести три политики с `is_admin()` на `erp_is_manager()`
 * одной миграцией вместе с этим гейтом.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmployeesScreen from './EmployeesScreen';
import { useErpStore, resetErpStore } from '../store/useErpStore';
import { useAuthStore } from '../../store/useAuthStore';

const PROFILES = [
  { id: 'u-admin', name: 'Ирина', email: 'irina@pinhead.ru', role: 'admin', active: true, approved: true },
  { id: 'u-new', name: 'Пётр', email: 'petr@pinhead.ru', role: 'manager', active: true, approved: false },
];

const LOOSE = [
  { id: 'e-1', full_name: 'Работник без логина', role: 'worker', active: true, profile_id: null },
];

function seed(profileRole) {
  useAuthStore.setState({ user: { id: 'u-me', role: profileRole, name: 'Я' } });
  useErpStore.setState({
    loaded: true,
    employeesLoaded: true,
    employeesError: null,
    profilesList: PROFILES,
    employees: LOOSE,
    departments: [{ id: 'd-1', code: 'sewing', name: 'Швейный цех', active: true, sort_order: 10 }],
    permissions: {},
    myRole: profileRole === 'admin' ? 'director' : 'director',
    loadAll: vi.fn(),
    loadEmployees: vi.fn(),
    createEmployee: vi.fn(),
    updateEmployee: vi.fn(),
    updateProfile: vi.fn(),
    upsertProfileDept: vi.fn(),
  });
}

describe('EmployeesScreen: учётные записи ведёт администратор', () => {
  beforeEach(() => {
    resetErpStore();
    vi.restoreAllMocks();
  });

  it('админ видит список логинов и действия по ним', () => {
    seed('admin');
    render(<EmployeesScreen embedded />);

    expect(screen.getByText('irina@pinhead.ru')).toBeInTheDocument();
    // «Подтвердить» — то самое действие, которое молча не срабатывало
    expect(screen.getByRole('button', { name: 'Подтвердить' })).toBeInTheDocument();
  });

  /**
   * Директор пускается в раздел, но список ему сервер не отдаёт. Показать
   * при этом одну строку (его собственную) значит соврать числом, поэтому
   * таблицы нет вовсе, а вместо неё — объяснение.
   */
  it('директору список логинов не показывается, и отказ назван', () => {
    seed('director');
    render(<EmployeesScreen embedded />);

    expect(screen.queryByText('irina@pinhead.ru')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Подтвердить' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/учётные записи ведёт администратор/i);
  });

  /**
   * Цеховые работники без логина читаются всеми участниками
   * (`erp_employees_read` — `erp_is_member()`), поэтому список остаётся
   * видимым. А правка гасится целиком: нативный `fieldset[disabled]` честен
   * для клавиатуры и не забудет ни одного из двух десятков полей.
   */
  it('работники без логина видны директору, но только на чтение', () => {
    seed('director');
    const { container } = render(<EmployeesScreen embedded />);

    expect(screen.getByText('Работник без логина')).toBeInTheDocument();
    const fieldset = container.querySelector('fieldset[disabled]');
    expect(fieldset, 'блок правки не заперт').toBeTruthy();
    expect(fieldset).toHaveTextContent('Работник без логина');
  });

  it('у админа поля не заперты', () => {
    seed('admin');
    const { container } = render(<EmployeesScreen embedded />);
    expect(container.querySelector('fieldset[disabled]')).toBeNull();
  });
});
