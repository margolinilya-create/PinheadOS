import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { newSalesItem, newSalesOrder } from '../model/factory';

/**
 * PDF ТЗ на «К запуску»: iframe только для PDF по первым байтам и только при
 * встроенном просмотрщике; переключатель групп — `aria-pressed`, `title` iframe
 * меняется с группой.
 */
const art = vi.hoisted(() => ({ artworkSignedUrl: vi.fn(), artworkDownloadUrl: vi.fn() }));
vi.mock('../api/artworks', async (orig) => ({ ...(await orig()), ...art }));

const { default: TzFrame } = await import('./TzFrame');

const ID = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const path = (g) => `orders/${ID}/tz/aaaa-PH-1-g${g}-c123456789ab-x.pdf`;
const order = newSalesOrder({
  id: ID, number: 'PH-1', status: 'ready_to_launch',
  items: [
    newSalesItem({ product_type: 'Футболка', sku_code: 'tee', tz_pdf_path: path('11111111') }),
    newSalesItem({ product_type: 'Худи', sku_code: 'hoodie', tz_pdf_path: path('22222222') }),
  ],
});

let bytes = '%PDF-1.7';
const fetchMock = vi.fn(async () => new Response(new TextEncoder().encode(bytes)));

function setViewer(on) {
  Object.defineProperty(navigator, 'pdfViewerEnabled', { value: on, configurable: true });
}

beforeEach(() => {
  bytes = '%PDF-1.7';
  art.artworkSignedUrl.mockReset().mockImplementation(async (p) => `https://storage.test/${p}`);
  vi.stubGlobal('fetch', fetchMock);
  setViewer(true);
});
afterEach(() => vi.unstubAllGlobals());

describe('TzFrame', () => {
  it('PDF по первым байтам и просмотрщик есть — iframe с названием группы', async () => {
    render(<TzFrame order={order} />);
    const frame = await screen.findByTitle('ТЗ к заказу PH-1 — группа 1 из 2');
    expect(frame.tagName).toBe('IFRAME');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('g11111111'), { headers: { Range: 'bytes=0-15' } });
  });

  it('переключатель групп: aria-pressed и title iframe меняются, фокус не переносится', async () => {
    render(<TzFrame order={order} />);
    await screen.findByTitle('ТЗ к заказу PH-1 — группа 1 из 2');
    const second = screen.getByRole('button', { name: 'ТЗ 2 из 2: Худи' });
    expect(second).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(second);
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'ТЗ 1 из 2: Футболка' })).toHaveAttribute('aria-pressed', 'false');
    expect(await screen.findByTitle('ТЗ к заказу PH-1 — группа 2 из 2')).toBeInTheDocument();
  });

  it('не PDF по первым байтам (SVG под .pdf) — без iframe и без «Открыть», только «Скачать»', async () => {
    bytes = '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>';
    render(<TzFrame order={order} />);
    expect(await screen.findByText('Файл не открывается как PDF — его можно только скачать')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Открыть в новой вкладке' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Скачать' })).toBeInTheDocument();
  });

  it('возврат на вкладку через 9+ минут — новая подписанная ссылка; раньше — нет', async () => {
    let now = 1_000_000;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    render(<TzFrame order={order} />);
    await screen.findByTitle('ТЗ к заказу PH-1 — группа 1 из 2');
    expect(art.artworkSignedUrl).toHaveBeenCalledTimes(1);
    now += 5 * 60 * 1000;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(art.artworkSignedUrl).toHaveBeenCalledTimes(1);
    now += 5 * 60 * 1000;
    // Обработчик с новым `doc.at` подписывает пассивный эффект — после отрисовки,
    // а не вместе с ней: под нагрузкой (CI) первое событие ловил прежний
    // обработчик с `at = 0`. Событие повторяется, пока эффект не подхватит время;
    // лишнего обновления не будет — после него `at` снова свежий
    await waitFor(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      expect(art.artworkSignedUrl).toHaveBeenCalledTimes(2);
    });
    spy.mockRestore();
  });

  it('встроенного просмотрщика нет — карточка «ТЗ 1 из 2 · PDF» с «Открыть» и «Скачать»', async () => {
    setViewer(false);
    render(<TzFrame order={order} />);
    expect(await screen.findByRole('button', { name: 'Открыть в новой вкладке' })).toBeInTheDocument();
    expect(screen.getByText('ТЗ 1 из 2 · PDF')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });
});
