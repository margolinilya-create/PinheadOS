import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchCatalogKey } from '../../../lib/catalogs';
import { putCatalog } from '../../api/catalogAdmin';
import { uploadFlatSvg } from '../../api/garmentFlats';
import { useToastStore } from '../../../store/useToastStore';
import { sanitizeSvg } from '../assets/sanitizeSvg';
import seed from './garmentFlats.seed.json';
import { seedFlats, SEED_CONCURRENCY } from './seedFlats';
import { SEED_FILES_COUNT, SEED_FLATS_COUNT } from './seedInfo';

vi.mock('../../../lib/catalogs', async (orig) => ({ ...(await orig<object>()), fetchCatalogKey: vi.fn() }));
vi.mock('../../api/catalogAdmin', async (orig) => ({ ...(await orig<object>()), putCatalog: vi.fn() }));
vi.mock('../../api/garmentFlats', async (orig) => ({ ...(await orig<object>()), uploadFlatSvg: vi.fn() }));
// Настоящий санитайзер под наблюдением: сид обязан грузить ЕГО результат, а не сырой текст
vi.mock('../assets/sanitizeSvg', async (orig) => {
  const real = await orig<typeof import('../assets/sanitizeSvg')>();
  return { ...real, sanitizeSvg: vi.fn(real.sanitizeSvg) };
});

const fetchMock = vi.mocked(fetchCatalogKey);
const putMock = vi.mocked(putCatalog);
const uploadMock = vi.mocked(uploadFlatSvg);
const sanitizeSpy = vi.mocked(sanitizeSvg);
const RAW = import.meta.glob('./flats/*.svg', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

type Flat = { id: string; views: { kind: string; svg_path: string }[] };
const SEED_FLATS = (seed as unknown as { flats: Flat[] }).flats;
const errors = () => useToastStore.getState().toasts.filter((t) => t.type === 'error').map((t) => t.message);

beforeEach(() => {
  fetchMock.mockReset();
  putMock.mockReset();
  uploadMock.mockReset();
  sanitizeSpy.mockClear();
  useToastStore.setState({ toasts: [] });
  fetchMock.mockResolvedValue({ exists: false, value: null });
  uploadMock.mockResolvedValue('uploaded');
  putMock.mockResolvedValue({ ok: true });
});

describe('seedFlats — пустой справочник', () => {
  it('грузит все SVG, справочник пишет последним, базой — «строки нет»', async () => {
    const res = await seedFlats();
    expect(res).toEqual({ uploaded: SEED_FILES_COUNT, existed: 0, failed: 0, added: SEED_FLATS_COUNT, catalog: 'saved' });
    expect(uploadMock).toHaveBeenCalledTimes(SEED_FILES_COUNT);
    expect(putMock).toHaveBeenCalledTimes(1);
    const [table, key, value, base] = putMock.mock.calls[0];
    expect([table, key, base]).toEqual(['app_config', 'garmentFlats', null]);
    expect(value).toEqual(seed);
    // Запись справочника — после последней загрузки
    expect(putMock.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...uploadMock.mock.invocationCallOrder));
  });

  it('грузит очищенный SVG по пути справочника, каждый путь — один раз', async () => {
    await seedFlats();
    const paths = uploadMock.mock.calls.map((c) => c[0]);
    expect(new Set(paths)).toEqual(new Set(SEED_FLATS.flatMap((f) => f.views.map((v) => v.svg_path))));
    expect(paths).toHaveLength(new Set(paths).size);
    // Каждый файл прошёл санитайзер, и в бакет ушёл ЕГО результат: сырой текст сида
    // уже «чистый» (сторож сида), поэтому сверка с выходом санитайзера, а не с `<svg`
    expect(sanitizeSpy).toHaveBeenCalledTimes(SEED_FILES_COUNT);
    const cleaned = sanitizeSpy.mock.results.map((r) => (r.value as { svg: string }).svg);
    expect(uploadMock.mock.calls.map((c) => c[1])).toEqual(cleaned);
    const byPath = new Map(SEED_FLATS.flatMap((f) => f.views.map((v) => [v.svg_path, `./flats/${f.id}-${v.kind}.svg`] as const)));
    const [path, text] = uploadMock.mock.calls[0];
    expect(sanitizeSpy.mock.calls[0][0]).toBe(RAW[byPath.get(path) ?? '']);
    expect(text).toContain('id="garment"');
  });

  it('прогресс: от 0 до всех файлов, затем запись справочника', async () => {
    const onProgress = vi.fn();
    await seedFlats({ onProgress });
    const calls = onProgress.mock.calls.map((c) => c[0]);
    expect(calls[0]).toEqual({ done: 0, total: SEED_FILES_COUNT, phase: 'files' });
    const done = calls.filter((p) => p.phase === 'files').map((p) => p.done);
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(calls.at(-1)).toEqual({ done: SEED_FILES_COUNT, total: SEED_FILES_COUNT, phase: 'catalog' });
  });

  it(`не больше ${SEED_CONCURRENCY} загрузок одновременно`, async () => {
    let now = 0;
    let peak = 0;
    uploadMock.mockImplementation(async () => {
      now += 1;
      peak = Math.max(peak, now);
      await Promise.resolve();
      now -= 1;
      return 'uploaded';
    });
    await seedFlats();
    expect(peak).toBe(SEED_CONCURRENCY);
  });
});

describe('seedFlats — один сид на вкладку браузера', () => {
  it('повторный вызов, пока сид летит, присоединяется к нему: без второй загрузки и записи', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    uploadMock.mockImplementation(async () => {
      await gate;
      return 'uploaded';
    });
    const first = seedFlats();
    await vi.waitFor(() => expect(uploadMock).toHaveBeenCalled());
    const onProgress = vi.fn();
    const second = seedFlats({ onProgress });
    // Новый слушатель сразу получает текущий прогресс
    expect(onProgress).toHaveBeenCalledWith({ done: 0, total: SEED_FILES_COUNT, phase: 'files' });
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledTimes(SEED_FILES_COUNT);
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ uploaded: SEED_FILES_COUNT, existed: 0, failed: 0, added: SEED_FLATS_COUNT, catalog: 'saved' });
    expect(a.joined).toBeUndefined();
    expect(b).toEqual({ ...a, joined: true });
    expect(onProgress.mock.calls.at(-1)?.[0]).toEqual({ done: SEED_FILES_COUNT, total: SEED_FILES_COUNT, phase: 'catalog' });
  });

  it('после завершения — и после исключения — следующий вызов начинает новый сид', async () => {
    fetchMock.mockRejectedValueOnce(new Error('сеть'));
    await expect(seedFlats()).rejects.toThrow('сеть');
    await seedFlats();
    await seedFlats();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(putMock).toHaveBeenCalledTimes(2);
  });
});

describe('seedFlats — сбой и повтор', () => {
  it('частичный сбой: справочник не тронут, тост называет число файлов', async () => {
    const bad = SEED_FLATS[5].views[0].svg_path;
    uploadMock.mockImplementation(async (path) => (path === bad ? null : 'uploaded'));
    const res = await seedFlats();
    expect(putMock).not.toHaveBeenCalled();
    expect(res.catalog).toBe('error');
    expect(res.failed).toBeGreaterThan(0);
    expect(res.uploaded + res.existed + res.failed).toBe(SEED_FILES_COUNT);
    expect(errors().at(-1)).toMatch(new RegExp(`не загружено ${res.failed} файл(а|ов)? из ${SEED_FILES_COUNT}`));
    expect(errors().at(-1)).toContain('Справочник не изменён');
  });

  it('после сбоя новые загрузки не начинаются (не больше уже летящих)', async () => {
    uploadMock.mockResolvedValue(null);
    const res = await seedFlats();
    expect(uploadMock.mock.calls.length).toBeLessThanOrEqual(SEED_CONCURRENCY);
    expect(res.failed).toBe(SEED_FILES_COUNT);
  });

  it('повтор: «уже есть» — успех, справочник дописывается', async () => {
    uploadMock.mockImplementation(async (path) => (path.endsWith('front.svg') ? 'exists' : 'uploaded'));
    const res = await seedFlats();
    expect(res.catalog).toBe('saved');
    expect(res.existed).toBe(SEED_FLATS.length);
    expect(res.uploaded).toBe(SEED_FILES_COUNT - SEED_FLATS.length);
    expect(res.failed).toBe(0);
  });

  it('конфликт записи справочника — `conflict`', async () => {
    putMock.mockResolvedValue({ ok: false, kind: 'conflict', message: 'x' });
    expect((await seedFlats()).catalog).toBe('conflict');
  });

  it('отказ записи справочника — `error`', async () => {
    putMock.mockResolvedValue({ ok: false, kind: 'forbidden', message: 'x' });
    expect((await seedFlats()).catalog).toBe('error');
  });
});

describe('seedFlats — справочник уже есть', () => {
  it('дописывает только недостающие, существующие не трогает', async () => {
    const own = { id: 'tshirt-freefit', name: 'Своя правка', version: 3, extra: true };
    const base = { version: 1, flats: [own], note: 'своё поле' };
    fetchMock.mockResolvedValue({ exists: true, value: base });
    const res = await seedFlats();
    expect(res.added).toBe(SEED_FLATS_COUNT - 1);
    expect(uploadMock.mock.calls.some((c) => c[0].startsWith('flats/tshirt-freefit/'))).toBe(false);
    const [, , value, sentBase] = putMock.mock.calls[0];
    expect(sentBase).toBe(base);
    const out = value as { version: number; note: string; flats: { id: string }[] };
    expect(out.flats[0]).toBe(own);
    expect(out.flats.map((f) => f.id)).toEqual(['tshirt-freefit', ...SEED_FLATS.filter((f) => f.id !== 'tshirt-freefit').map((f) => f.id)]);
    expect(out.note).toBe('своё поле');
    expect(out.version).toBe(1);
  });

  it('флэт 5б (история v1, рукав, tz_row) сид не трогает: та же запись, история на месте (К16)', async () => {
    const id = SEED_FLATS[0].id;
    const view = (kind: string, v: number) => ({
      kind, svg_path: `flats/${id}/v${v}/${kind}.svg`, scale_mm_per_unit: 1,
      anchors: kind === 'sleeve_left' ? { sleeve_bottom_y: 500, sleeve_center_x: 120 } : { center_axis_x: 300 },
      print_areas: [{ id: 'z', name: 'Зона', zone_id: kind === 'sleeve_left' ? 'sleeve-l' : 'front', tz_row: kind === 'front' ? 'front_l' : 'sleeve_l', polygon_mm: [[0, 0], [10, 0], [10, 10], [0, 10]], safe_inset_mm: 0 }],
    });
    const own = { id, name: 'Правленый', version: 2, views: [view('front', 2), view('sleeve_left', 2)], history: [{ version: 1, views: [view('front', 1)] }] };
    const snapshot = JSON.stringify(own);
    const base = { version: 1, flats: [own] };
    fetchMock.mockResolvedValue({ exists: true, value: base });
    await seedFlats();
    expect(uploadMock.mock.calls.some((c) => c[0].startsWith(`flats/${id}/`))).toBe(false);
    const out = putMock.mock.calls[0][2] as { flats: unknown[] };
    expect(out.flats[0]).toBe(own);
    expect(JSON.stringify(out.flats[0])).toBe(snapshot);
  });

  it('все типовые уже есть — ничего не грузит и не пишет', async () => {
    fetchMock.mockResolvedValue({ exists: true, value: seed });
    const res = await seedFlats();
    expect(res).toEqual({ uploaded: 0, existed: 0, failed: 0, added: 0, catalog: 'unchanged' });
    expect(uploadMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it('справочник не прочитан — ничего не грузит', async () => {
    fetchMock.mockResolvedValue(null);
    expect((await seedFlats()).catalog).toBe('error');
    expect(uploadMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it('справочник в базе неверной формы — отказ с тостом, без загрузок', async () => {
    fetchMock.mockResolvedValue({ exists: true, value: ['не тот формат'] });
    expect((await seedFlats()).catalog).toBe('error');
    expect(uploadMock).not.toHaveBeenCalled();
    expect(errors().at(-1)).toMatch(/справочник флэтов в базе неверной формы/i);
  });
});
