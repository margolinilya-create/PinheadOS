import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSalesStore, __resetSalesStoreForTests } from '../../store/useSalesStore';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../../model/factory';
import type { SalesOrderStatus } from '../../model/types';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import type { ZoneDefinition } from '../../../types/catalog';
import { useDesignStore } from '../store/useDesignStore';
import { parseLayout } from '../model/layout';
import { flat } from '../fixtures.testutil';
import { pngBytes, textBytes } from './bytes.testutil';
import { MSG_FORMAT } from './sniff';
import {
  MSG_NO_AREA, MSG_OTHER_ITEM, MSG_PDF_UNAVAILABLE, MSG_READ_ONLY, MSG_TARGET_CHANGED,
  addArtworkFile, addExistingArtwork, useAddArtwork, type ArtworkTarget,
} from './useAddArtwork';

vi.mock('../../api/salesOrders', async (orig) => ({
  ...(await orig<typeof import('../../api/salesOrders')>()),
  saveSalesOrder: vi.fn(() => new Promise(() => {})),
}));
const api = vi.hoisted(() => ({ uploadArtwork: vi.fn(), uploadArtworkPreview: vi.fn(), removeArtwork: vi.fn() }));
vi.mock('../../api/artworks', async (orig) => ({ ...(await orig<typeof import('../../api/artworks')>()), ...api }));
const pdf = vi.hoisted(() => ({ loadPdf: vi.fn() }));
vi.mock('./loadPdf', () => pdf);
const images = vi.hoisted(() => ({ primeArtworkImage: vi.fn(), releaseArtworkImages: vi.fn() }));
vi.mock('./artworkImages', () => images);
vi.mock('./flatImages', () => ({ releaseFlatImages: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('../../../store/useToastStore', () => ({ toast }));
const upd = vi.hoisted(() => ({ handlePossibleUpdate: vi.fn(() => false) }));
vi.mock('../../../lib/appUpdate', () => upd);

const ORDER = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const PATH = `orders/${ORDER}/logo/1b2c3d4e-0000-4000-8000-000000000000-logo.png`;
const FLAT = flat();
const T: ArtworkTarget = {
  orderId: ORDER, itemKey: 'a', flat: FLAT, view: 'front',
  zonesCatalog: ZONES_CATALOG_DEFAULT as unknown as ZoneDefinition[], category: 'tshirts', rules: null,
};

const png = (name = 'logo.png') => new File([pngBytes(1417, 945, 300) as BlobPart], name, { type: 'image/png' });
const item = (key = 'a') => useSalesStore.getState().current!.items.find((it) => it.key === key)!;

function open(status: SalesOrderStatus = 'draft') {
  useSalesStore.setState({
    current: newSalesOrder({ id: ORDER, status, items: [newSalesItem({ key: 'a' }), newSalesItem({ key: 'b' })] }),
    saveState: status === 'draft' ? 'clean' : 'locked',
  });
  useDesignStore.getState().bind(ORDER, 'a');
}

beforeEach(() => {
  __resetSalesStoreForTests();
  useDesignStore.getState().reset();
  Object.values(api).forEach((f) => f.mockReset());
  pdf.loadPdf.mockReset();
  images.primeArtworkImage.mockReset();
  toast.error.mockReset();
  upd.handlePossibleUpdate.mockReset();
  upd.handlePossibleUpdate.mockReturnValue(false);
  api.uploadArtwork.mockResolvedValue(PATH);
  api.uploadArtworkPreview.mockImplementation(async (_o: string, p: string) => `${p}.preview.png`);
});

describe('addArtworkFile — PNG', () => {
  it('исходник сразу в бакет, нанесение на холсте с флэтом позиции, выбрано', async () => {
    open();
    const file = png();
    const key = await addArtworkFile(file, T);
    expect(api.uploadArtwork).toHaveBeenCalledWith(ORDER, 'logo', file);
    expect(api.uploadArtworkPreview).not.toHaveBeenCalled();
    expect(item().flat_id).toBe(FLAT.id);
    expect(item().prints).toHaveLength(1);
    const p = item().prints[0];
    expect(p.key).toBe(key);
    expect(p).toMatchObject({ zone: 'Грудь (перед)', artwork_path: PATH, width_mm: 120, height_mm: 80, offset_from: 'neck_seam', on: 'cut' });
    expect(parseLayout(p.layout)?.asset).toMatchObject({ type: 'png', source_file: 'logo.png', px_w: 1417, has_preview: false });
    expect(useDesignStore.getState().selectedPrintKey).toBe(key);
    expect(useSalesStore.getState().saveState).toBe('dirty');
    const [primedPath, primedPreview, blob, size] = images.primeArtworkImage.mock.calls[0];
    expect([primedPath, primedPreview, (blob as Blob).type]).toEqual([PATH, false, 'image/png']);
    // Пиксели из заголовка — большой растр уменьшится для показа и сразу после загрузки
    expect(size).toEqual({ width: 1417, height: 945 });
  });

  it('SVG — без размера растра (уменьшать нечего)', async () => {
    open();
    const svg = new File([textBytes('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm"/>') as BlobPart], 'logo.svg');
    await addArtworkFile(svg, T);
    expect(images.primeArtworkImage.mock.calls[0][3]).toBeNull();
  });

  it('техника — по правилам категории в зоне (defaultMethod)', async () => {
    open();
    await addArtworkFile(png(), { ...T, rules: { allowedTechs: ['dtf', 'dtg'], allowedZoneTechs: null } });
    expect(item().prints[0].method).toBe('dtf');
  });

  it('один шаг отмены: undo убирает нанесение и флэт', async () => {
    open();
    await addArtworkFile(png(), T);
    useDesignStore.getState().undo();
    expect(item()).toMatchObject({ prints: [], flat_id: '' });
  });

  it('загрузка не удалась — нанесения нет, заказ не тронут', async () => {
    open();
    api.uploadArtwork.mockResolvedValue(null);
    expect(await addArtworkFile(png(), T)).toBeNull();
    expect(item().prints).toEqual([]);
    expect(useSalesStore.getState().saveState).toBe('clean');
    expect(useDesignStore.getState().past).toEqual([]);
  });

  it('зона из опций чужого вида — зона по умолчанию', async () => {
    open();
    await addArtworkFile(png(), T, { areaId: 'back' });
    expect(parseLayout(item().prints[0].layout)?.area_id).toBe('chest');
  });
});

describe('addArtworkFile — PDF/AI', () => {
  const pdfFile = () => new File([textBytes('%PDF-1.7\n') as BlobPart], 'Лого.pdf', { type: 'application/pdf' });
  const preview = new Blob([pngBytes(200, 100) as BlobPart], { type: 'image/png' });
  const pdfMeta = { type: 'png', source_file: 'Лого.pdf', intrinsic_w_mm: 100, intrinsic_h_mm: 50, size_estimated: false, has_preview: true };

  it('два пути: исходник и …preview.png; раскладка помнит превью', async () => {
    open();
    pdf.loadPdf.mockResolvedValue({ ok: true, asset: { meta: pdfMeta, png: preview } });
    const file = pdfFile();
    await addArtworkFile(file, T);
    expect(pdf.loadPdf.mock.calls[0][1]).toBe('Лого.pdf');
    expect(api.uploadArtwork).toHaveBeenCalledWith(ORDER, 'logo', file);
    expect(api.uploadArtworkPreview).toHaveBeenCalledWith(ORDER, PATH, preview);
    expect(parseLayout(item().prints[0].layout)?.asset.has_preview).toBe(true);
    expect(images.primeArtworkImage).toHaveBeenCalledWith(PATH, true, preview, null);
  });

  it('превью не легло — исходник убран, нанесения нет', async () => {
    open();
    pdf.loadPdf.mockResolvedValue({ ok: true, asset: { meta: pdfMeta, png: preview } });
    api.uploadArtworkPreview.mockResolvedValue(null);
    expect(await addArtworkFile(pdfFile(), T)).toBeNull();
    expect(api.removeArtwork).toHaveBeenCalledWith(PATH, { missingOk: true });
    expect(item().prints).toEqual([]);
  });

  it('модуль PDF не загрузился (устаревшая вкладка) — диалог обновления, в бакет ничего', async () => {
    open();
    const err = new Error('Failed to fetch dynamically imported module');
    vi.doMock('./loadPdf', () => { throw err; });
    try {
      upd.handlePossibleUpdate.mockReturnValue(true);
      expect(await addArtworkFile(pdfFile(), T)).toBeNull();
      expect(upd.handlePossibleUpdate).toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      upd.handlePossibleUpdate.mockReturnValue(false);
      expect(await addArtworkFile(pdfFile(), T)).toBeNull();
      expect(toast.error).toHaveBeenCalledWith(MSG_PDF_UNAVAILABLE);
      expect(api.uploadArtwork).not.toHaveBeenCalled();
    } finally {
      vi.doMock('./loadPdf', () => pdf);
    }
  });

  it('PDF не открылся — текст ошибки, в бакет ничего', async () => {
    open();
    pdf.loadPdf.mockResolvedValue({ ok: false, error: 'PDF не открылся' });
    expect(await addArtworkFile(pdfFile(), T)).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('PDF не открылся');
    expect(api.uploadArtwork).not.toHaveBeenCalled();
  });
});

describe('addArtworkFile — отказы', () => {
  it('PSD — отказ с текстом, в бакет ничего', async () => {
    open();
    const psd = new File([textBytes('8BPS\u0000\u0001') as BlobPart], 'maket.psd', { type: '' });
    expect(await addArtworkFile(psd, T)).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(MSG_FORMAT);
    expect(api.uploadArtwork).not.toHaveBeenCalled();
  });

  it('больше 25 МБ — отказ до чтения', async () => {
    open();
    const big = png();
    Object.defineProperty(big, 'size', { value: 25 * 1024 * 1024 + 1 });
    expect(await addArtworkFile(big, T)).toBeNull();
    expect(api.uploadArtwork).not.toHaveBeenCalled();
  });

  it('не черновик — ничего не грузится и не пишется', async () => {
    open('ready_to_launch');
    expect(await addArtworkFile(png(), T)).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(MSG_READ_ONLY);
    expect(api.uploadArtwork).not.toHaveBeenCalled();
  });

  it('холст на другой позиции — верная причина, в бакет ничего', async () => {
    open();
    useDesignStore.getState().bind(ORDER, 'b');
    expect(await addArtworkFile(png(), T)).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(MSG_OTHER_ITEM);
    expect(api.uploadArtwork).not.toHaveBeenCalled();
    expect(addExistingArtwork({ path: PATH, asset: { type: 'svg', source_file: 'a.svg', intrinsic_w_mm: 10, intrinsic_h_mm: 10, size_estimated: false, has_preview: false } }, T)).toBeNull();
    expect(toast.error).toHaveBeenLastCalledWith(MSG_OTHER_ITEM);
  });

  it('на виде нет зоны — отказ ДО загрузки (файл не ложится «ничьим»)', async () => {
    open();
    const noBack = { ...T, flat: flat({ views: [FLAT.views[0]] }), view: 'back' as const };
    expect(await addArtworkFile(png(), noBack)).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(MSG_NO_AREA);
    expect(api.uploadArtwork).not.toHaveBeenCalled();
  });

  it('позиция сменилась, пока файл шёл, — нанесение не создаётся', async () => {
    open();
    let finish!: (p: string) => void;
    api.uploadArtwork.mockReturnValue(new Promise((r) => { finish = r; }));
    const pending = addArtworkFile(png(), T);
    await vi.waitFor(() => expect(api.uploadArtwork).toHaveBeenCalled());
    useDesignStore.getState().bind(ORDER, 'b');
    finish(PATH);
    expect(await pending).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(MSG_TARGET_CHANGED);
    expect(item('a').prints).toEqual([]);
    expect(item('b').prints).toEqual([]);
  });
});

describe('без задвоения и «Логотипы заказа»', () => {
  it('неразмещённая строка той же зоны получает логотип — нанесений по-прежнему одно', async () => {
    open();
    const row = newSalesPrint({ zone: 'Грудь (перед)', method: 'dtg' });
    useSalesStore.setState((s) => ({ current: { ...s.current!, items: s.current!.items.map((it) => (it.key === 'a' ? { ...it, prints: [row] } : it)) } }));
    expect(await addArtworkFile(png(), T)).toBe(row.key);
    expect(item().prints).toHaveLength(1);
    expect(item().prints[0]).toMatchObject({ key: row.key, method: 'dtg', artwork_path: PATH });
  });

  it('повторное использование файла заказа — без загрузки', () => {
    open();
    const asset = { type: 'svg' as const, source_file: 'a.svg', intrinsic_w_mm: 100, intrinsic_h_mm: 50, size_estimated: false, has_preview: false };
    const key = addExistingArtwork({ path: PATH, asset }, T);
    expect(api.uploadArtwork).not.toHaveBeenCalled();
    expect(item().prints.map((p) => p.key)).toEqual([key]);
    expect(item().prints[0].artwork_path).toBe(PATH);
  });
});

describe('useAddArtwork', () => {
  it('busy, пока файл грузится; без цели — null', async () => {
    open();
    let finish!: (p: string) => void;
    api.uploadArtwork.mockReturnValue(new Promise((r) => { finish = r; }));
    const { result } = renderHook(() => useAddArtwork(T));
    let pending!: Promise<string | null>;
    act(() => { pending = result.current.addFile(png()); });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      await vi.waitFor(() => expect(api.uploadArtwork).toHaveBeenCalled());
      finish(PATH);
      await pending;
    });
    expect(result.current.busy).toBe(false);
    const none = renderHook(() => useAddArtwork(null));
    expect(await none.result.current.addFile(png())).toBeNull();
    expect(none.result.current.addExisting({ path: PATH, asset: parseLayout(item().prints[0].layout)!.asset })).toBeNull();
  });
});
