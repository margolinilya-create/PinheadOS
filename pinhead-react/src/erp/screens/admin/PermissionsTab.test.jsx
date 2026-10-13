import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PermissionsTab } from './PermissionsTab';
import { useErpStore } from '../../store/useErpStore';
import { ERP_PERMISSIONS, ERP_PERMISSION_LABELS } from '../../types';

/**
 * §5 обхода 04.09: матрица прав — 15 колонок и 17 прав без единой группировки,
 * а клик по галочке писался мгновенно, без отката и без следа, кто и когда
 * снял право. Это единственная настройка раздела, которая молча отключает
 * людям работу.
 */

const setRolePermission = vi.fn(async () => true);

function seed(patch = {}) {
  setRolePermission.mockClear();
  useErpStore.setState({
    permissionMatrix: { worker: { 'stage.take': true } },
    permissionTrail: [],
    permissionsLoaded: true,
    permissionsError: null,
    loadPermissions: vi.fn(async () => true),
    setRolePermission,
    employees: [],
    ...patch,
  });
}

beforeEach(() => { seed(); });

describe('матрица прав', () => {
  it('права сгруппированы, и ни одно не потеряно', () => {
    render(<PermissionsTab />);
    for (const title of ['Работа цеха', 'Снабжение и склад', 'Настройка системы']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    /**
     * Право, забытое в перечислении групп, молча исчезло бы с экрана —
     * пропуск ничего не роняет. Проверяем, что видны ВСЕ.
     */
    for (const p of ERP_PERMISSIONS) {
      expect(screen.getAllByText(ERP_PERMISSION_LABELS[p]).length).toBeGreaterThan(0);
    }
  });

  it('после правки появляется отмена, и она возвращает прежнее значение', async () => {
    render(<PermissionsTab />);
    const cell = screen.getByRole('checkbox', { name: 'Брать задания в работу — Сотрудник цеха' });
    fireEvent.click(cell);
    await waitFor(() => expect(setRolePermission).toHaveBeenCalledWith('worker', 'stage.take', false));

    const undo = await screen.findByRole('button', { name: /Отменить/ });
    fireEvent.click(undo);
    await waitFor(() => expect(setRolePermission).toHaveBeenLastCalledWith('worker', 'stage.take', true));
  });

  /** Половина ответа лучше, чем ничего, но выдавать её за журнал нельзя */
  it('след правок назван последним изменением, а не историей', () => {
    seed({
      permissionTrail: [{
        role: 'worker', permission: 'stage.take', allowed: false,
        updated_at: '2026-09-04T10:00:00Z', updated_by: 'u1',
      }],
      employees: [{ id: 'e1', profile_id: 'u1', full_name: 'Иван Петров' }],
    });
    render(<PermissionsTab />);
    expect(screen.getByText(/Иван Петров/)).toBeInTheDocument();
    expect(screen.getByText(/полной истории система\s+не ведёт/)).toBeInTheDocument();
  });
});
