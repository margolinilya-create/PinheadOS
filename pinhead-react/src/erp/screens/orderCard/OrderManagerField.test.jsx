import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useErpStore } from '../../store/useErpStore';
import { OrderManagerField } from './OrderManagerField';

/**
 * МЕНЕДЖЕР ЗАКАЗА — СОТРУДНИК (правки 19.10, п. 7, решение Р3): колонка
 * `erp_orders.manager_id`. Ставит `order.manage`, и только сотрудником ERP
 * (у человека есть карточка `erp_employees` — `role` в справочнике чата):
 * менеджер становится наблюдателем задач заказа и получателем уведомлений.
 */

const DIR = [
  { user_id: 'u1', name: 'Анна Петрова', email: null, role: 'manager', department_id: null },
  { user_id: 'u2', name: 'Борис без карточки', email: null, role: null, department_id: null },
  { user_id: 'u3', name: 'Вера Цех', email: null, role: 'worker', department_id: 'd1' },
];

let load;
beforeEach(() => {
  load = vi.fn(async () => {});
  useErpStore.setState({ chatDirectory: DIR, chatDirectoryLoaded: true, loadChatDirectory: load });
});

describe('OrderManagerField', () => {
  it('с order.manage — выбор только из сотрудников ERP, сохраняет manager_id', async () => {
    const onSave = vi.fn(async () => true);
    render(<OrderManagerField order={{ id: 'o1', manager_id: null }} canManage onSave={onSave} />);
    const select = screen.getByLabelText('Менеджер заказа (сотрудник)');
    const options = [...select.querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual(['не назначен', 'Анна Петрова', 'Вера Цех']);
    fireEvent.change(select, { target: { value: 'u1' } });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ manager_id: 'u1' }));
  });

  it('«не назначен» снимает менеджера', async () => {
    const onSave = vi.fn(async () => true);
    render(<OrderManagerField order={{ id: 'o1', manager_id: 'u1' }} canManage onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Менеджер заказа (сотрудник)'), { target: { value: '' } });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ manager_id: null }));
  });

  it('без права — только чтение, имя менеджера', () => {
    render(<OrderManagerField order={{ id: 'o1', manager_id: 'u3' }} canManage={false} onSave={vi.fn()} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Вера Цех')).toBeInTheDocument();
  });

  it('справочник не загружен — грузит его', () => {
    useErpStore.setState({ chatDirectoryLoaded: false, chatDirectory: [] });
    render(<OrderManagerField order={{ id: 'o1', manager_id: null }} canManage={false} onSave={vi.fn()} />);
    expect(load).toHaveBeenCalled();
    expect(screen.getByText('не назначен')).toBeInTheDocument();
  });
});
