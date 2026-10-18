import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SummaryTab from './SummaryTab';
import { newSalesItem, newSalesOrder } from '../model/factory';
import { fixtureCatalogs } from '../fixtures/loadFixture.testutil';
import { sendChecklist } from '../tz/model/sendChecklist';
import { __resetSalesStoreForTests } from '../store/useSalesStore';

/**
 * «ТЗ и цена» (веха 6+7, задача 5): оплата, ТЗ групп, чек-лист и единственная
 * точка «Отправить в работу». Цепочка отправки и движок PDF — заглушки
 * (их проверяют `sendToWork.test.ts` и `tzPdf.test.ts`).
 */
const send = vi.hoisted(() => ({ sendToWork: vi.fn() }));
vi.mock('../tz/sendToWork', () => send);
const engine = vi.hoisted(() => ({
  buildTzPdf: vi.fn(),
  buildAllTzPdf: vi.fn(),
}));
vi.mock('../tz/ui/tzExport', () => ({ loadTzEngineOrNull: vi.fn(async () => engine) }));
vi.mock('../api/salesEvents', () => ({ lastOverride: vi.fn(async () => null), lastReturn: vi.fn(async () => null) }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('../../store/useToastStore', () => ({ toast }));

const live = { active: true, approved: true };
const SELLER = { id: 'u-seller', role: 'manager', is_sales: true, ...live };
const NOT_SALES = { id: 'u-seller', role: 'manager', is_sales: false, is_ms: true, ...live };
const ROP = { id: 'u-rop', role: 'rop', ...live };
const MS = { id: 'u-ms', role: 'manager', is_ms: true, ...live };

const ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const catalogs = fixtureCatalogs();
const item = (patch = {}) => newSalesItem({
  key: 'a', sku_code: 'TEE', product_type: 'Футболка', fabric_code: 'medas-kulirnaya-100-180',
  size_grid: { sizes: ['M'], rows: [{ color: 'Чёрный', sizes: { M: 10 } }] }, ...patch,
});
const order = (patch = {}) => newSalesOrder({
  id: ID, number: 'PH-0042', customer: 'ООО Ромашка', due_date: '2026-11-01', created_by: 'u-seller',
  updated_at: 'v1', items: [item()], ...patch,
});

/** Оплата, ТЗ и отправка — ленивый чанк: ждём, пока он приедет */
async function renderTab(o, user = SELLER, extra = {}) {
  const checklist = extra.checklist ?? sendChecklist(o, catalogs, { marginPct: null, minMarginPct: null });
  const props = {
    order: o, price: null, readOnly: false, itemHref: (k) => `?tab=item&item=${k}`, onDiscount: () => {},
    user, catalogs, catalogsFailed: false, checklist, today: '2026-10-18', focusSend: false, onSendFocused: () => {},
    ...extra,
  };
  const view = render(<MemoryRouter><SummaryTab {...props} /></MemoryRouter>);
  await screen.findByRole('heading', { name: 'Оплата' });
  return { ...view, rerenderWith: (next) => view.rerender(<MemoryRouter><SummaryTab {...props} {...next} /></MemoryRouter>) };
}

const sendBtn = () => screen.getByRole('button', { name: 'Отправить в работу' });

beforeEach(() => {
  __resetSalesStoreForTests();
  send.sendToWork.mockReset();
  engine.buildTzPdf.mockReset();
  engine.buildAllTzPdf.mockReset();
  toast.success.mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:tz-1');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); });

describe('«Отправить в работу» на «ТЗ и цена»', () => {
  it('продавец без is_sales кнопки не видит', async () => {
    await renderTab(order(), NOT_SALES);
    expect(screen.queryByRole('button', { name: 'Отправить в работу' })).toBeNull();
    expect(screen.getByText('Отправить в работу может автор заказа или руководитель продаж')).toBeInTheDocument();
  });

  it('руководитель видит причину недоступности; клик фокусирует первый блокирующий пункт, отправка не зовётся', async () => {
    await renderTab(order({ customer: '', created_by: 'other' }), ROP);
    const btn = sendBtn();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toBeDisabled();
    const why = screen.getByText('Исправьте 1 пункт чек-листа, чтобы отправить');
    expect(btn.getAttribute('aria-describedby')).toBe(why.id);
    fireEvent.click(btn);
    expect(document.activeElement?.textContent).toContain('Укажите клиента');
    expect(send.sendToWork).not.toHaveBeenCalled();
  });

  it('маржа ниже порога — пункт-предупреждение, кнопка доступна', async () => {
    const o = order();
    await renderTab(o, SELLER, { checklist: sendChecklist(o, catalogs, { marginPct: 10, minMarginPct: 25 }) });
    expect(screen.getByText(/Маржа 10 % ниже порога 25 %/)).toBeInTheDocument();
    expect(sendBtn()).not.toHaveAttribute('aria-disabled');
  });

  it('успех: тост, затем фокус на заголовке «Отправлен в работу 18.10 — правка закрыта»', async () => {
    send.sendToWork.mockResolvedValue({ ok: true });
    const { rerenderWith } = await renderTab(order());
    await act(async () => { fireEvent.click(sendBtn()); });
    expect(send.sendToWork).toHaveBeenCalledWith(ID, expect.objectContaining({ catalogs, today: '2026-10-18' }));
    expect(toast.success).toHaveBeenCalledWith('Заказ отправлен в работу');
    rerenderWith({ order: order({ status: 'ready_to_launch', sent_at: '2026-10-18T09:00:00Z' }) });
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Отправлен в работу 18.10 — правка закрыта'));
    expect(document.activeElement?.tagName).toBe('H2');
  });

  it('отказ: текст шага в role=alert, фокус на нём', async () => {
    send.sendToWork.mockResolvedValue({ ok: false, stage: 'upload', reason: 'ТЗ не загрузилось в хранилище — проверьте связь и нажмите ещё раз' });
    await renderTab(order());
    await act(async () => { fireEvent.click(sendBtn()); });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('ТЗ не загрузилось в хранилище');
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it('не черновик: кнопки отправки нет, сборки всех ТЗ нет; оплату у МС в ready_to_launch видно', async () => {
    await renderTab(order({ status: 'ready_to_launch', sent_at: '2026-10-18T09:00:00Z' }), MS);
    expect(screen.queryByRole('button', { name: 'Отправить в работу' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Скачать черновик всех ТЗ/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Предпросмотр ТЗ' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Отметить предоплату' })).toBeInTheDocument();
    expect(engine.buildAllTzPdf).not.toHaveBeenCalled();
  });

  it('не черновик: продавец оплату не отмечает в production', async () => {
    await renderTab(order({ status: 'production', sent_at: '2026-10-18T09:00:00Z' }), SELLER);
    expect(screen.queryByRole('button', { name: 'Отметить предоплату' })).toBeNull();
    expect(screen.getByText('Оплата: не отмечена')).toBeInTheDocument();
  });
});

describe('ТЗ: предпросмотр и черновик всех ТЗ', () => {
  it('предпросмотр — ссылка с blob-URL на месте кнопки, без window.open', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    engine.buildTzPdf.mockResolvedValue({ blob: new Blob(['%PDF-1.4 x'.repeat(200)]), hash12: 'x', doc: {} });
    await renderTab(order());
    expect(screen.getByText(/^ТЗ 1 из 1: Футболка, Кулирная гладь .* — 1 цвет, 10 шт\.$/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр ТЗ' })); });
    const link = await screen.findByRole('link', { name: /^Открыть ТЗ 1 из 1 \(PDF, \d+ КБ\)$/ });
    expect(link).toHaveAttribute('href', 'blob:tz-1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Скачать' })).toHaveAttribute('download');
    expect(open).not.toHaveBeenCalled();
    expect(engine.buildTzPdf).toHaveBeenCalledWith(expect.objectContaining({ issuedOn: '2026-10-18', catalogs }));
  });

  it('новая сборка и уход со вкладки отзывают прежний URL', async () => {
    engine.buildTzPdf.mockResolvedValue({ blob: new Blob(['%PDF']), hash12: 'x', doc: {} });
    const { unmount } = await renderTab(order());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр ТЗ' })); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Собрать заново' })); });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('в черновике с несколькими группами — «Скачать черновик всех ТЗ (не отправлено)» собирает все', async () => {
    engine.buildAllTzPdf.mockResolvedValue(new Blob(['%PDF']));
    const two = order({ items: [item(), item({ key: 'b', sku_code: 'HOOD', product_type: 'Худи' })] });
    await renderTab(two);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Скачать черновик всех ТЗ (не отправлено)' })); });
    expect(engine.buildAllTzPdf).toHaveBeenCalledWith(expect.objectContaining({ groups: expect.arrayContaining([expect.anything(), expect.anything()]) }));
  });

  it('отказ сборки предпросмотра — текст отказа в role=alert', async () => {
    const err = new Error('шрифт не загрузился');
    err.name = 'TzPdfError';
    engine.buildTzPdf.mockRejectedValue(err);
    await renderTab(order());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр ТЗ' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('ТЗ не собрано: шрифт не загрузился');
  });
});
