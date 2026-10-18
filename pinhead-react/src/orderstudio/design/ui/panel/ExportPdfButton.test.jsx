import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as confirmStore from '../../../../store/useConfirmStore';
import { useConfirmStore } from '../../../../store/useConfirmStore';
import { resetUpdatePrompt } from '../../../../lib/appUpdate';
import { useToastStore } from '../../../../store/useToastStore';
import { useStore } from '../../../../store/useStore';
import { saveBlob } from '../../../../utils/saveBlob';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../../../model/factory';
import { flat as flatFixture } from '../../fixtures.testutil';
import { MaketPdfError, maketPages } from '../../export/maketPages';
import ExportPdfButton from './ExportPdfButton';
import { hasMaketPages, maketToolsChunk, pdfEngine } from './maketExport';

/*
 * Ленивость: фабрика мока исполняется, только когда модуль впервые
 * импортируют. Кнопка тянет движок PDF `import()` по клику — до первого
 * клика в файле фабрика молчит. Шпион `loaded` между тестами НЕ сбрасывается:
 * статический импорт движка вызвал бы его ещё при загрузке кнопки
 */
const engine = vi.hoisted(() => ({ loaded: vi.fn(), exportMaketPdf: vi.fn() }));
vi.mock('../../export/exportPdf', () => {
  engine.loaded();
  return { exportMaketPdf: engine.exportMaketPdf };
});
vi.mock('../../../../utils/saveBlob', () => ({ saveBlob: vi.fn() }));

const BUTTON = 'Скачать PDF макета';

const layout = (patch = {}) => ({
  v: 1, flat_id: 'tshirt-test', flat_version: 1, view: 'front', area_id: 'chest',
  x_mm: 250, y_mm: 167, rotation_deg: 0, flip_h: false, flip_v: false,
  asset: { type: 'png', source_file: 'logo.png', intrinsic_w_mm: 100, intrinsic_h_mm: 80, px_w: 2000, px_h: 1600, size_estimated: false, has_preview: false },
  ...patch,
});

const placed = (patch = {}) => newSalesPrint({
  key: 'p1', method: 'dtf', zone: 'Грудь (перед)', width_mm: 100, height_mm: 80,
  artwork_path: 'orders/ab/logo/1-logo.png', layout: layout(), ...patch,
});

const order = newSalesOrder({ id: 'ab', number: 'PH-1234', customer: 'ООО «Ромашка»', status: 'ready_to_launch' });
const itemWith = (prints) => newSalesItem({
  key: 'i1', product_type: 'Футболка Regular', prints,
  size_grid: { sizes: ['M'], rows: [{ color: 'Чёрный', sizes: { M: 10 } }] },
});

const toasts = () => useToastStore.getState().toasts.filter((t) => t.type === 'error').map((t) => t.message);

function renderButton(props = {}) {
  return render(<ExportPdfButton order={order} item={itemWith([placed()])} flat={flatFixture()} {...props} />);
}

beforeEach(() => {
  engine.exportMaketPdf.mockReset();
  vi.mocked(saveBlob).mockClear();
  useToastStore.setState({ toasts: [] });
  useStore.setState({ skuCatalog: [], categoryRules: [] });
});

afterEach(() => vi.restoreAllMocks());

describe('ExportPdfButton — «Скачать PDF макета»', () => {
  it('движок PDF не грузится до клика (тест первый в файле)', () => {
    renderButton();
    expect(screen.getByRole('button', { name: BUTTON })).toBeEnabled();
    expect(engine.loaded).not.toHaveBeenCalled();
    expect(engine.exportMaketPdf).not.toHaveBeenCalled();
  });

  it('клик: движок загружен, PDF собран по заказу и позиции и скачан под ASCII-именем', async () => {
    const blob = new Blob(['%PDF-'], { type: 'application/pdf' });
    engine.exportMaketPdf.mockResolvedValue(blob);
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(blob, 'PH-1234-Futbolka_Regular-Chernyy-maket.pdf'));
    expect(engine.loaded).toHaveBeenCalledTimes(1);
    const [input] = engine.exportMaketPdf.mock.calls[0];
    expect(input.orderId).toBe('ab');
    expect(input.flat.id).toBe('tshirt-test');
    expect(input.item.prints.map((p) => p.key)).toEqual(['p1']);
    expect(input.meta).toMatchObject({
      client: 'ООО «Ромашка»', orderNumber: 'PH-1234', itemTitle: 'Футболка Regular · Чёрный · 10 шт', statusLabel: 'Готов к запуску',
    });
    expect(input.garmentHex).toMatch(/^#[0-9a-f]{6}$/i);
    expect(await screen.findByRole('status')).toHaveTextContent('PDF макета готов: PH-1234-Futbolka_Regular-Chernyy-maket.pdf');
  });

  it('пока собирается — «Готовлю PDF…», aria-busy, повторный клик не запускает вторую сборку', async () => {
    let finish;
    engine.exportMaketPdf.mockImplementation(() => new Promise((r) => { finish = r; }));
    renderButton();
    const button = screen.getByRole('button', { name: BUTTON });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    expect(button).toHaveTextContent('Готовлю PDF…');
    fireEvent.click(button);
    await waitFor(() => expect(engine.exportMaketPdf).toHaveBeenCalledTimes(1));
    finish(new Blob(['%PDF-']));
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'false'));
    expect(button).toHaveTextContent(BUTTON);
    expect(engine.exportMaketPdf).toHaveBeenCalledTimes(1);
  });

  it('отказ сборки — тост с причиной; сбой библиотеки — общий текст', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    engine.exportMaketPdf.mockRejectedValueOnce(new MaketPdfError('логотип 1 не скачался'));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    await waitFor(() => expect(toasts()).toEqual(['PDF макета не собран: логотип 1 не скачался']));
    engine.exportMaketPdf.mockRejectedValueOnce(new TypeError('x is undefined'));
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    await waitFor(() => expect(toasts()).toHaveLength(2));
    expect(toasts()[1]).toBe('PDF макета не собран — повторите или сообщите администратору');
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it('замечания проверки — спросить, но не запрещать: «Вернуться» — без сборки, «Скачать всё равно» — сборка', async () => {
    engine.exportMaketPdf.mockResolvedValue(new Blob(['%PDF-']));
    // Растр 150 px на 100 мм — ниже нижнего порога DTF: серьёзное замечание
    const low = placed({ layout: layout({ asset: { ...layout().asset, px_w: 150, px_h: 120 } }) });
    const ask = vi.spyOn(confirmStore, 'confirm').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<ExportPdfButton order={order} item={itemWith([low])} flat={flatFixture()} />);
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    const opts = ask.mock.calls[0][0];
    expect(opts.title).toBe('Проверьте макет перед PDF');
    expect(opts.message).toMatch(/DPI/);
    expect(opts.confirmLabel).toBe('Скачать PDF всё равно');
    expect(opts.cancelLabel).toBe('Вернуться к макету');
    expect(engine.exportMaketPdf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    await waitFor(() => expect(engine.exportMaketPdf).toHaveBeenCalledTimes(1));
  });

  it('без замечаний — без вопроса', async () => {
    engine.exportMaketPdf.mockResolvedValue(new Blob(['%PDF-']));
    const ask = vi.spyOn(confirmStore, 'confirm');
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    await waitFor(() => expect(engine.exportMaketPdf).toHaveBeenCalled());
    expect(ask).not.toHaveBeenCalled();
  });

  it('нет нанесений на холсте или нет силуэта — кнопка выключена, причина рядом', () => {
    const { rerender } = render(<ExportPdfButton order={order} item={itemWith([placed({ layout: null })])} flat={flatFixture()} />);
    const button = screen.getByRole('button', { name: BUTTON });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Поставьте логотип на изделие — тогда можно скачать PDF макета');
    rerender(<ExportPdfButton order={order} item={itemWith([placed()])} flat={null} />);
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Для модели нет силуэта — PDF макета не собрать');
  });

  it('выключена снаружи (disabled) — без причины от кнопки; только чтение заказа PDF не запрещает', () => {
    const { rerender } = renderButton({ disabled: true });
    const button = screen.getByRole('button', { name: BUTTON });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAccessibleDescription();
    rerender(<ExportPdfButton order={{ ...order, status: 'production' }} item={itemWith([placed()])} flat={flatFixture()} />);
    expect(button).toBeEnabled();
  });

});

describe('hasMaketPages — признак «есть что скачать» без загрузки листов', () => {
  it('совпадает с maketPages(item, flat).length > 0', () => {
    const f = flatFixture();
    const cases = [
      [],
      [placed()],
      [placed({ layout: null })],
      [placed({ layout: layout({ flat_id: 'other-flat' }) })],
      [placed({ layout: layout({ area_id: 'nope' }) })],
      [placed({ layout: layout({ view: 'back', area_id: 'back' }) })],
      [placed({ layout: { broken: true } })],
      [placed({ layout: null }), placed({ key: 'p2' })],
    ];
    for (const prints of cases) {
      const it0 = itemWith(prints);
      expect(hasMaketPages(it0, f), JSON.stringify(prints.map((p) => p.layout))).toBe(maketPages(it0, f).length > 0);
    }
    expect(hasMaketPages(itemWith([placed()]), null)).toBe(false);
  });
});

describe('ExportPdfButton — движок PDF не загрузился', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useConfirmStore.setState({ open: false, title: '' });
    resetUpdatePrompt();
  });

  it('сбой сети — тост «сборка PDF не загрузилась», кнопка снова доступна', async () => {
    vi.spyOn(pdfEngine, 'load').mockRejectedValue(new TypeError('network down'));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    await waitFor(() => expect(toasts()).toEqual(['Сборка PDF не загрузилась — обновите страницу и повторите']));
    expect(screen.getByRole('button', { name: BUTTON })).toHaveAttribute('aria-busy', 'false');
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it('листы макета не загрузились — тост, без вопроса и без сборки', async () => {
    vi.spyOn(maketToolsChunk, 'load').mockRejectedValue(new TypeError('network down'));
    const ask = vi.spyOn(confirmStore, 'confirm');
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    await waitFor(() => expect(toasts()).toEqual(['Сборка PDF не загрузилась — обновите страницу и повторите']));
    expect(ask).not.toHaveBeenCalled();
    expect(engine.exportMaketPdf).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: BUTTON })).toBeEnabled();
  });

  it('чанк пропал после выкладки — общий диалог «Вышло обновление», без тоста', async () => {
    vi.spyOn(pdfEngine, 'load').mockRejectedValue(new TypeError('Failed to fetch dynamically imported module: /assets/exportPdf-1.js'));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    await waitFor(() => expect(useConfirmStore.getState().open).toBe(true));
    expect(useConfirmStore.getState().title).toBe('Вышло обновление приложения');
    expect(toasts()).toEqual([]);
  });
});
