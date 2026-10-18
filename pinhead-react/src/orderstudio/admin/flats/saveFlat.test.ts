import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadFlatSvg, listFlatVersions, uploadFlatSvgOnce } from '../../api/garmentFlats';
import { putCatalog } from '../../api/catalogAdmin';
import { invalidateFlatsCatalog } from '../../design/catalog/useFlatsCatalog';
import { clone, flat } from '../../design/fixtures.testutil';
import type { GarmentFlat } from '../../design/types';
import {
  MAX_VERSION_ATTEMPTS, MSG_TOO_BIG, MSG_VERSIONS_BUSY, MSG_VERSIONS_RACE, msgTransferFailed, saveFlat,
  type SaveFlatInput,
} from './saveFlat';

/**
 * Сохранение флэта (веха 5б, задача 3): файлы → версия → справочник.
 * Бакет — словарь «путь → текст» (как настоящий: объект неизменяем, «уже есть»
 * сверяется содержимым), справочник и сброс кэша — шпионы.
 */
vi.mock('../../api/garmentFlats', async (orig) => ({
  ...(await orig<object>()),
  uploadFlatSvgOnce: vi.fn(),
  listFlatVersions: vi.fn(),
  downloadFlatSvg: vi.fn(),
}));
vi.mock('../../api/catalogAdmin', async (orig) => ({ ...(await orig<object>()), putCatalog: vi.fn() }));
vi.mock('../../design/catalog/useFlatsCatalog', () => ({ invalidateFlatsCatalog: vi.fn() }));

const uploadMock = vi.mocked(uploadFlatSvgOnce);
const listMock = vi.mocked(listFlatVersions);
const downloadMock = vi.mocked(downloadFlatSvg);
const putMock = vi.mocked(putCatalog);
const invalidateMock = vi.mocked(invalidateFlatsCatalog);

const svg = (w: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 700"><g id="garment"><path d="M0 0L${w} 0L${w} 700Z"/></g></svg>`;
const OLD = svg(600);
const NEW = svg(610);

/** Бакет: путь → текст. `failOnce` — пути, загрузка которых один раз откажет */
let bucket: Map<string, string>;
let failOnce: Set<string>;

beforeEach(() => {
  vi.clearAllMocks();
  bucket = new Map();
  failOnce = new Set();
  uploadMock.mockImplementation(async (path, text) => {
    if (failOnce.delete(path)) return null;
    const had = bucket.get(path);
    if (had === undefined) {
      bucket.set(path, text);
      return 'uploaded';
    }
    return had === text ? 'same' : 'differs';
  });
  listMock.mockImplementation(async (id) => {
    const nums = [...bucket.keys()].map((p) => new RegExp(`^flats/${id}/v(\\d+)/`).exec(p)?.[1]).filter(Boolean).map(Number);
    return [...new Set(nums)].sort((a, b) => a - b);
  });
  downloadMock.mockImplementation(async (path) => bucket.get(path) ?? null);
  putMock.mockResolvedValue({ ok: true });
});

/** Справочник в базе с флэтом v1, чьи файлы лежат в бакете */
function stored(f: GarmentFlat = flat(), others: unknown[] = []) {
  for (const v of f.views) bucket.set(v.svg_path, OLD);
  return { version: 1, flats: [...others, f] };
}

function input(patch: Partial<SaveFlatInput>): SaveFlatInput {
  const base = patch.base === undefined ? flat() : patch.base;
  return {
    rawBase: patch.rawBase === undefined ? stored(base ?? flat()) : patch.rawBase,
    base,
    draft: patch.draft ?? clone(base ?? flat()),
    files: patch.files ?? {},
    ...(patch.onProgress ? { onProgress: patch.onProgress } : {}),
    ...(patch.raceRetry ? { raceRetry: true } : {}),
  };
}

const uploadedPaths = () => uploadMock.mock.calls.map((c) => c[0]);
const sentCatalog = () => putMock.mock.calls[0][2] as { version: 1; flats: GarmentFlat[] };

describe('saveFlat — новый флэт', () => {
  it('файлы v1 обоих видов, затем ровно один putCatalog; справочник — последним', async () => {
    const draft = flat({ id: 'polo-new' });
    const res = await saveFlat(input({ base: null, rawBase: stored(), draft, files: { front: NEW, back: NEW } }));
    expect(res).toMatchObject({ ok: true, released: 1 });
    expect(uploadedPaths()).toEqual(['flats/polo-new/v1/front.svg', 'flats/polo-new/v1/back.svg']);
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(putMock.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...uploadMock.mock.invocationCallOrder));
    expect(sentCatalog().flats.map((f) => f.id)).toEqual(['tshirt-test', 'polo-new']);
    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });

  it('строки справочника нет — insert: { version: 1, flats: [flat] } с базой null', async () => {
    const draft = flat({ id: 'polo-new' });
    const res = await saveFlat(input({ base: null, rawBase: null, draft, files: { front: NEW, back: NEW } }));
    expect(res.ok).toBe(true);
    const [table, key, value, base] = putMock.mock.calls[0];
    expect([table, key, base]).toEqual(['app_config', 'garmentFlats', null]);
    expect(value).toEqual({ version: 1, flats: [res.ok && res.flat] });
  });

  it('id уже занят (в том числе битой записью) — invalid без сети', async () => {
    const res = await saveFlat(input({ base: null, rawBase: stored(flat(), [{ id: 'polo-new', broken: true }]), draft: flat({ id: 'polo-new' }), files: { front: NEW, back: NEW } }));
    expect(res).toMatchObject({ ok: false, kind: 'invalid' });
    expect(uploadMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it('в бакет уходит выход санитайзера: <script> вырезан', async () => {
    const evil = NEW.replace('<g id="garment">', '<script>alert(1)</script><g id="garment" onload="x()">');
    const res = await saveFlat(input({ base: null, rawBase: null, draft: flat({ id: 'evil' }), files: { front: evil, back: NEW } }));
    expect(res.ok).toBe(true);
    const front = uploadMock.mock.calls[0][1];
    expect(front).not.toMatch(/script|onload/);
    expect(front).toContain('id="garment"');
  });
});

describe('saveFlat — метаданные и геометрия', () => {
  it('только метаданные: ни одной загрузки, версия прежняя, без листинга бакета', async () => {
    const base = flat();
    const draft = { ...clone(base), name: 'Футболка новая', views: base.views.map((v) => ({ ...v, print_areas: v.print_areas.map((a) => ({ ...a, tz_row: 'front_l' as const })) })) };
    const res = await saveFlat(input({ base, draft }));
    expect(res).toMatchObject({ ok: true, released: null });
    expect(uploadMock).not.toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
    expect(sentCatalog().flats[0]).toMatchObject({ version: 1, name: 'Футболка новая' });
    expect(sentCatalog().flats[0].history).toBeUndefined();
  });

  it('геометрия у v1 с двумя видами: обе загрузки в v2 (спина — перенос), история { 1, views }', async () => {
    const base = flat();
    const res = await saveFlat(input({ base, files: { front: NEW } }));
    expect(res).toMatchObject({ ok: true, released: 2 });
    expect(uploadedPaths()).toEqual(['flats/tshirt-test/v2/front.svg', 'flats/tshirt-test/v2/back.svg']);
    expect(downloadMock).toHaveBeenCalledWith('flats/tshirt-test/v1/back.svg');
    expect(bucket.get('flats/tshirt-test/v2/back.svg')).toBe(bucket.get('flats/tshirt-test/v1/back.svg'));
    const out = sentCatalog().flats[0];
    expect(out.version).toBe(2);
    expect(out.views.map((v) => v.svg_path)).toEqual(['flats/tshirt-test/v2/front.svg', 'flats/tshirt-test/v2/back.svg']);
    expect(out.history).toEqual([{ version: 1, views: base.views }]);
  });

  it('история черновика не принимается: записи — из базы', async () => {
    const base = flat({ version: 2, views: flat({ version: 2 }).views, history: [{ version: 1, views: flat().views }] });
    const draft = { ...clone(base), history: [] };
    const res = await saveFlat(input({ base, draft, files: { front: NEW } }));
    expect(res.ok).toBe(true);
    expect(sentCatalog().flats[0].history).toEqual([...base.history!, { version: 2, views: base.views }]);
  });

  it('прочие записи — те же ссылки, с полями будущих клиентов', async () => {
    const neighbour = { ...flat({ id: 'other' }), parts: [{ id: 'sleeve', color: 'x' }] };
    const extra = flat({ id: 'third', active: false });
    const res = await saveFlat(input({ base: flat(), rawBase: stored(flat(), [neighbour, extra]), files: { front: NEW } }));
    expect(res.ok).toBe(true);
    const out = sentCatalog().flats;
    expect(out[0]).toBe(neighbour);
    expect(out[1]).toBe(extra);
  });
});

describe('saveFlat — «уже есть» и номера версий', () => {
  it('«уже есть» с тем же текстом — успех', async () => {
    bucket.set('flats/tshirt-test/v2/front.svg', NEW);
    bucket.set('flats/tshirt-test/v2/back.svg', OLD);
    const res = await saveFlat(input({ base: flat(), files: { front: NEW } }));
    // v2 занят в бакете — стартовая версия по листингу v3; same там не нужен.
    // Тот же сценарий без листинга (гонка) — в тесте повтора после сбоя
    expect(res).toMatchObject({ ok: true, released: 3 });
  });

  it('«уже есть» с другим текстом — следующая версия, все виды заново', async () => {
    listMock.mockResolvedValueOnce([1]); // второй администратор пишет v2 после листинга
    bucket.set('flats/tshirt-test/v2/back.svg', 'чужое');
    const res = await saveFlat(input({ base: flat(), files: { front: NEW } }));
    expect(res).toMatchObject({ ok: true, released: 3 });
    expect(uploadedPaths()).toEqual([
      'flats/tshirt-test/v2/front.svg', 'flats/tshirt-test/v2/back.svg',
      'flats/tshirt-test/v3/front.svg', 'flats/tshirt-test/v3/back.svg',
    ]);
    expect(sentCatalog().flats[0].version).toBe(3);
  });

  it('в бакете заняты v2…v6 при справочнике на v1 — выпуск в v7 без единого «differs»', async () => {
    for (let v = 2; v <= 6; v += 1) bucket.set(`flats/tshirt-test/v${v}/front.svg`, `сирота ${v}`);
    const res = await saveFlat(input({ base: flat(), files: { front: NEW } }));
    expect(res).toMatchObject({ ok: true, released: 7 });
    expect(uploadedPaths()).toEqual(['flats/tshirt-test/v7/front.svg', 'flats/tshirt-test/v7/back.svg']);
    expect(listMock).toHaveBeenCalledWith('tshirt-test');
  });

  it(`исчерпание: ${MAX_VERSION_ATTEMPTS} раз «differs» подряд — files, справочник не тронут, номера растут`, { timeout: 2000 }, async () => {
    listMock.mockResolvedValue([1]);
    uploadMock.mockResolvedValue('differs');
    const res = await saveFlat(input({ base: flat(), files: { front: NEW } }));
    expect(res).toEqual({ ok: false, kind: 'files', message: MSG_VERSIONS_RACE });
    expect(putMock).not.toHaveBeenCalled();
    const versions = uploadedPaths().map((p) => Number(/\/v(\d+)\//.exec(p)?.[1]));
    expect(versions).toEqual([2, 3, 4, 5, 6]);
    // Следующая попытка после «Загрузить свежую версию» — строже
    const again = await saveFlat(input({ base: flat(), files: { front: NEW }, raceRetry: true }));
    expect(again).toMatchObject({ ok: false, message: MSG_VERSIONS_BUSY });
  });

  it('листинг бакета не прочитан — files, ни одной загрузки', async () => {
    listMock.mockResolvedValue(null);
    const res = await saveFlat(input({ base: flat(), files: { front: NEW } }));
    expect(res).toMatchObject({ ok: false, kind: 'files' });
    expect(uploadMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
  });
});

describe('saveFlat — сбой и повтор', () => {
  it('сбой файла — справочник не пишется, кэш не сбрасывается', async () => {
    failOnce.add('flats/tshirt-test/v2/back.svg');
    const res = await saveFlat(input({ base: flat(), files: { front: NEW } }));
    expect(res).toMatchObject({ ok: false, kind: 'files' });
    expect(putMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it('повтор после сбоя на втором виде: первый — same, второй — uploaded, один putCatalog', async () => {
    const seen: string[] = [];
    const real = uploadMock.getMockImplementation()!;
    uploadMock.mockImplementation(async (p, t) => {
      const r = await real(p, t);
      seen.push(`${p}:${r}`);
      return r;
    });
    // Листинг — как до первой попытки: занятый ею v2 он не видит (сироту видит, но
    // здесь проверяется именно сверка содержимым)
    listMock.mockResolvedValue([1]);
    failOnce.add('flats/tshirt-test/v2/back.svg');
    expect((await saveFlat(input({ base: flat(), files: { front: NEW } }))).ok).toBe(false);
    const res = await saveFlat(input({ base: flat(), files: { front: NEW } }));
    expect(res).toMatchObject({ ok: true, released: 2 });
    expect(seen.slice(-2)).toEqual(['flats/tshirt-test/v2/front.svg:same', 'flats/tshirt-test/v2/back.svg:uploaded']);
    expect(putMock).toHaveBeenCalledTimes(1);
  });

  it('сбой переноса: 0 загрузок, 0 putCatalog; повтор с удачным скачиванием — успех (неудача не кэшируется)', async () => {
    downloadMock.mockResolvedValueOnce(null);
    const res = await saveFlat(input({ base: flat(), files: { front: NEW } }));
    expect(res).toEqual({ ok: false, kind: 'files', message: msgTransferFailed('back') });
    expect(uploadMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
    const again = await saveFlat(input({ base: flat(), files: { front: NEW } }));
    expect(again).toMatchObject({ ok: true, released: 2 });
  });

  it('прогресс: файлы от 0 до числа видов, затем справочник', async () => {
    const onProgress = vi.fn();
    await saveFlat(input({ base: flat(), files: { front: NEW }, onProgress }));
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      { done: 0, total: 2, phase: 'files' },
      { done: 1, total: 2, phase: 'files' },
      { done: 2, total: 2, phase: 'files' },
      { done: 2, total: 2, phase: 'catalog' },
    ]);
  });
});

describe('saveFlat — справочник до запроса и отказы сервера', () => {
  it('битая чужая запись — invalid с её id, 0 загрузок, 0 putCatalog', async () => {
    const broken = { ...flat({ id: 'broken-one' }), garment_type: 'kimono' };
    const res = await saveFlat(input({ base: flat(), rawBase: stored(flat(), [broken]), files: { front: NEW } }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.kind).toBe('invalid');
    expect(res.ok === false && res.message).toMatch(/^Флэт «broken-one» в справочнике битый: .* — сохранение закроет сервер/);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it('справочник неверной формы — invalid без сети', async () => {
    const res = await saveFlat(input({ base: flat(), rawBase: ['не тот формат'] }));
    expect(res).toMatchObject({ ok: false, kind: 'invalid' });
    expect(putMock).not.toHaveBeenCalled();
  });

  it('отказ сервера 22023 — текст сервера дословно, кэш не сброшен', async () => {
    const server = 'Флэты: неверная запись — флэт «neighbour»: модель T-006 у двух активных флэтов';
    putMock.mockResolvedValue({ ok: false, kind: 'invalid', message: server });
    const res = await saveFlat(input({ base: flat(), draft: { ...flat(), name: 'Новое имя' } }));
    expect(res).toEqual({ ok: false, kind: 'invalid', message: server });
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it('конфликт — вид conflict', async () => {
    putMock.mockResolvedValue({ ok: false, kind: 'conflict', message: 'Справочник изменён — загрузите свежую версию' });
    const res = await saveFlat(input({ base: flat(), draft: { ...flat(), name: 'Новое имя' } }));
    expect(res).toMatchObject({ ok: false, kind: 'conflict' });
  });

  it('размер — в байтах UTF-8: кириллица у края 1 МБ не проходит до загрузки файлов', async () => {
    // 600 000 символов — меньше 1 МБ по длине строки, но 1,2 МБ в UTF-8
    const heavy = { ...flat({ id: 'heavy' }), note: 'я'.repeat(600_000) };
    expect(JSON.stringify(heavy).length).toBeLessThan(1048576);
    const res = await saveFlat(input({ base: flat(), rawBase: stored(flat(), [heavy]), files: { front: NEW } }));
    expect(res).toEqual({ ok: false, kind: 'invalid', message: MSG_TOO_BIG });
    expect(uploadMock).not.toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
  });
});
