import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ZONES_CATALOG_DEFAULT } from '../../../../data/constants';
import { useAuthStore } from '../../../../store/useAuthStore';
import { newPlacedPrint } from '../../model/layout';
import { flat as makeFlat } from '../../fixtures.testutil';
import { MSG_ADD_BLOCKED_MISMATCH } from '../useArtworkActions';
import { templateFromPrints } from './templateOps';
import MyLayouts, { MSG_NOTHING_TO_SAVE, MSG_PICK_PRINT } from './MyLayouts';

const api = vi.hoisted(() => ({
  listLayoutTemplates: vi.fn(),
  saveLayoutTemplate: vi.fn(),
  deleteLayoutTemplate: vi.fn(),
}));
vi.mock('../../../api/layoutTemplates', async (orig) => ({ ...(await orig()), ...api }));
const dlg = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('../../../../store/useConfirmStore', async (orig) => ({ ...(await orig()), ...dlg }));

const ORDER = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const UID = '11111111-1111-4111-8111-111111111111';
const ASSET = { type: 'png', source_file: 'logo.png', intrinsic_w_mm: 60, intrinsic_h_mm: 40, size_estimated: false, has_preview: false };
const flat = makeFlat();
const ctx = { flat, zonesCatalog: ZONES_CATALOG_DEFAULT, category: 'tshirts' };
const logo = newPlacedPrint(ASSET, `orders/${ORDER}/logo/a.png`, 'chest', { ...ctx, view: 'front', itemKind: 'sku', method: 'dtf' });
const tpl = templateFromPrints([logo], ctx);
const ROW = { id: 't1', name: 'Грудь', data: tpl };

function setup({ prints = [logo], selected = { print: logo, index: 0 }, addBlocked = false } = {}) {
  let next = prints;
  const commitPrints = vi.fn((_label, fn) => {
    const res = fn(next);
    if (res) next = res;
    return Boolean(res);
  });
  const d = { ctx, commitPrints, addBlocked };
  render(<MyLayouts d={d} item={{ prints }} selected={selected} />);
  return { commitPrints, result: () => next };
}

/** Раскрыть «Мои раскладки» (jsdom сам `toggle` не шлёт) */
const open = async () => {
  const det = screen.getByText('Мои раскладки').closest('details');
  det.open = true;
  fireEvent(det, new Event('toggle'));
  await waitFor(() => expect(api.listLayoutTemplates).toHaveBeenCalledWith(UID));
};
const click = (el) => act(async () => { fireEvent.click(el); });

describe('MyLayouts (веха 5в, Э8)', () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    dlg.confirm.mockReset();
    useAuthStore.setState({ user: { id: UID, name: 'Анна' } });
  });

  it('открытие вкладки ничего не грузит и не пишет; раскрытие — грузит список один раз', async () => {
    api.listLayoutTemplates.mockResolvedValue([ROW]);
    const { commitPrints } = setup();
    expect(api.listLayoutTemplates).not.toHaveBeenCalled();
    await open();
    expect(await screen.findByRole('combobox', { name: 'Раскладка' })).toHaveDisplayValue('Грудь · 1 нанесение');
    expect(commitPrints).not.toHaveBeenCalled();
    expect(api.listLayoutTemplates).toHaveBeenCalledTimes(1);
  });

  it('пустой список — подсказка; сохранение отправляет снимок позиции и добавляет строку', async () => {
    api.listLayoutTemplates.mockResolvedValue([]);
    api.saveLayoutTemplate.mockResolvedValue({ ...ROW, id: 'new', name: 'Команда' });
    setup();
    await open();
    expect(await screen.findByText(/Сохраните раскладку позиции/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Название новой раскладки' }), { target: { value: 'Команда' } });
    await click(screen.getByRole('button', { name: 'Сохранить раскладку позиции (1 нанесение)' }));
    expect(api.saveLayoutTemplate).toHaveBeenCalledWith(UID, 'Команда', tpl);
    expect(await screen.findByRole('combobox', { name: 'Раскладка' })).toHaveDisplayValue('Команда · 1 нанесение');
  });

  it('нечего сохранять — кнопка aria-disabled с причиной, запроса нет', async () => {
    api.listLayoutTemplates.mockResolvedValue([]);
    setup({ prints: [], selected: null });
    await open();
    const btn = screen.getByRole('button', { name: 'Сохранить раскладку позиции' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAccessibleDescription(MSG_NOTHING_TO_SAVE);
    await click(btn);
    expect(api.saveLayoutTemplate).not.toHaveBeenCalled();
  });

  it('«Разложить» пишет через commitPrints; без выбора и на чужом силуэте — с причиной', async () => {
    api.listLayoutTemplates.mockResolvedValue([ROW]);
    const { commitPrints, result } = setup();
    await open();
    await click(await screen.findByRole('button', { name: 'Разложить по раскладке' }));
    expect(commitPrints).toHaveBeenCalledWith('Раскладка', expect.any(Function));
    expect(result()).toHaveLength(1);
    expect(result()[0].key).toBe(logo.key);
  });

  it.each([
    ['не выбрано нанесение', { selected: null }, MSG_PICK_PRINT],
    ['силуэт другой модели', { addBlocked: true }, MSG_ADD_BLOCKED_MISMATCH],
  ])('%s — «Разложить» недоступно с причиной', async (_, opts, reason) => {
    api.listLayoutTemplates.mockResolvedValue([ROW]);
    const { commitPrints } = setup(opts);
    await open();
    const btn = await screen.findByRole('button', { name: 'Разложить по раскладке' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAccessibleDescription(reason);
    await click(btn);
    expect(commitPrints).not.toHaveBeenCalled();
  });

  it('удаление — после подтверждения; отказ — ничего', async () => {
    api.listLayoutTemplates.mockResolvedValue([ROW]);
    api.deleteLayoutTemplate.mockResolvedValue(true);
    setup();
    await open();
    dlg.confirm.mockResolvedValueOnce(false);
    await click(await screen.findByRole('button', { name: 'Удалить раскладку' }));
    expect(api.deleteLayoutTemplate).not.toHaveBeenCalled();
    dlg.confirm.mockResolvedValueOnce(true);
    await click(screen.getByRole('button', { name: 'Удалить раскладку' }));
    expect(api.deleteLayoutTemplate).toHaveBeenCalledWith('t1');
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Раскладка' })).toBeNull());
  });
});
