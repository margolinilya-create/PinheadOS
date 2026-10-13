import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { supabase } from '../../../lib/supabase';
import { ClientErrorsTab, CLIENT_ERRORS_LIMIT } from './ClientErrorsTab';

/** Цепочка select → order → limit, отдающая заданный ответ */
function answer(result) {
  const q = { select: () => q, order: () => q, limit: () => Promise.resolve(result) };
  vi.mocked(supabase.from).mockReturnValueOnce(q);
}

describe('ClientErrorsTab', () => {
  beforeEach(() => { vi.mocked(supabase.from).mockClear(); });

  it('показывает отчёт: источник, автор, сообщение', async () => {
    answer({
      data: [{
        id: '1', created_at: '2026-09-24T10:00:00Z', source: 'render',
        message: 'Cannot read properties of undefined', stack: 'at QueueRow',
        url: 'https://x/queue/sewing', release: null, user_agent: null,
        profile: { name: 'Иван' },
      }],
      error: null,
    });
    render(<ClientErrorsTab />);
    expect(await screen.findByText(/Экран упал · Иван · Cannot read/)).toBeInTheDocument();
    expect(supabase.from).toHaveBeenCalledWith('erp_client_errors');
  });

  it('пусто — честное пустое состояние, а не пустая таблица', async () => {
    answer({ data: [], error: null });
    render(<ClientErrorsTab />);
    expect(await screen.findByText('Ошибок интерфейса нет')).toBeInTheDocument();
  });

  it('отказ базы — кнопка «Повторить», а не вечный скелетон', async () => {
    answer({ data: null, error: { message: 'permission denied' } });
    render(<ClientErrorsTab />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Повторить/ })).toBeInTheDocument());
  });

  it('читает не больше CLIENT_ERRORS_LIMIT строк', () => {
    expect(CLIENT_ERRORS_LIMIT).toBeLessThanOrEqual(200);
  });
});

/**
 * Гейт вкладки обязан совпадать с политикой чтения таблицы: мягче — вкладка
 * есть, а сервер отдаёт пустоту; строже — отчёты не видит тот, кому они нужны.
 */
describe('вкладка «Ошибки» и политика erp_client_errors — одно право', () => {
  it('staff.invite с обеих сторон', () => {
    const admin = readFileSync(join(cwd(), 'src/erp/screens/AdminScreen.jsx'), 'utf8');
    expect(admin).toMatch(/\{ id: 'errors', label: 'Ошибки', needs: 'staff.invite' \}/);
    const sql = readFileSync(
      join(cwd(), '../supabase/migrations/20260924205222_erp_client_errors.sql'), 'utf8',
    );
    expect(sql).toMatch(/for select to authenticated\s+using \(\(select public\.erp_has_permission\('staff\.invite'\)\)\)/);
  });
});
