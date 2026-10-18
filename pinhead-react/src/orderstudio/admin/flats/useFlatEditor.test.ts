import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { createElement, Fragment, useEffect, type ReactNode } from 'react';
import { fetchCatalogKey } from '../../../lib/catalogs';
import { catalogHasUnsaved } from '../../leaveGuard';
import { clone, flat } from '../../design/fixtures.testutil';
import type { GarmentFlat } from '../../design/types';
import { MSG_VERSIONS_RACE, saveFlat } from './saveFlat';
import { tolerantFlat, useFlatEditor } from './useFlatEditor';

/**
 * Редактор флэта (веха 5б, задача 3, К7): свежее чтение, `broken`/`missing`,
 * `dirty` в `leaveGuard`, конфликт по правилу вехи 4, `reload` сохраняет файлы.
 * Писатель `saveFlat` — шпион: его порядок проверяет `saveFlat.test.ts`.
 */
vi.mock('../../../lib/catalogs', async (orig) => ({ ...(await orig<object>()), fetchCatalogKey: vi.fn() }));
vi.mock('./saveFlat', async (orig) => ({ ...(await orig<object>()), saveFlat: vi.fn() }));

const fetchMock = vi.mocked(fetchCatalogKey);
const saveMock = vi.mocked(saveFlat);
const ZONES = [{ id: 'front', name: 'Грудь (перед)' }, { id: 'back', name: 'Спина' }];
const NEW_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="garment"/></svg>';

let flatsRow: { exists: boolean; value: unknown } | null;
let zonesRow: { exists: boolean; value: unknown } | null;
/** Адреса, которые видел роутер (последний — текущий) */
const locations: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  flatsRow = { exists: true, value: { version: 1, flats: [flat()] } };
  zonesRow = { exists: true, value: ZONES };
  fetchMock.mockImplementation(async (_t, key) => (key === 'zonesCatalog' ? zonesRow : flatsRow));
});

function LocationProbe() {
  const loc = useLocation();
  useEffect(() => { locations.push(`${loc.pathname}${loc.search}`); }, [loc]);
  return null;
}

const wrapper = ({ children }: { children: ReactNode }) => createElement(
  MemoryRouter,
  { initialEntries: ['/order-settings?tab=flats&flat=new'] },
  createElement(Fragment, null, createElement(LocationProbe), children),
);

async function open(id = 'tshirt-test') {
  const hook = renderHook(({ fid }) => useFlatEditor(fid), { wrapper, initialProps: { fid: id } });
  await waitFor(() => expect(hook.result.current.state).not.toBe('loading'));
  return hook;
}

const okResult = (f: GarmentFlat, released: number | null = null) =>
  ({ ok: true as const, flat: f, raw: { version: 1, flats: [f] }, released });

describe('useFlatEditor — чтение', () => {
  it('свежее чтение справочника флэтов и зон мимо кэша; запись найдена — ready', async () => {
    const { result } = await open();
    expect(fetchMock).toHaveBeenCalledWith('app_config', 'garmentFlats');
    expect(fetchMock).toHaveBeenCalledWith('app_config', 'zonesCatalog');
    expect(result.current.state).toBe('ready');
    expect(result.current.draft).toEqual(flat());
    expect(result.current.base).toEqual(flat());
    expect(result.current.zonesCatalog).toEqual(ZONES);
    expect(result.current.dirty).toBe(false);
    expect(result.current.geometry).toBe(false);
    expect(result.current.nextVersion).toBe(1);
  });

  it('нет такого id — missing', async () => {
    const { result } = await open('no-such');
    expect(result.current.state).toBe('missing');
  });

  it('id занят и битой записью; битая — broken с замечаниями, repair открывает терпимо', async () => {
    const broken = { id: 'broken-one', name: 'Сломанный', version: 2, garment_type: 'kimono', views: [{ kind: 'front', svg_path: 'flats/broken-one/v2/front.svg' }] };
    flatsRow = { exists: true, value: { version: 1, flats: [flat(), broken] } };
    const { result } = await open('broken-one');
    expect(result.current.state).toBe('broken');
    expect(result.current.issues.length).toBeGreaterThan(0);
    expect(result.current.reservedIds.has('broken-one')).toBe(true);
    expect(result.current.draft).toBeNull();
    act(() => result.current.repair());
    expect(result.current.state).toBe('ready');
    expect(result.current.draft).toMatchObject({ id: 'broken-one', name: 'Сломанный', version: 2, sku_codes: [], views: [{ kind: 'front', anchors: {}, print_areas: [] }] });
  });

  it('справочник зон не загрузился — null, сохранение открыто', async () => {
    zonesRow = null;
    saveMock.mockImplementation(async (i) => okResult(i.draft));
    const { result } = await open();
    expect(result.current.zonesCatalog).toBeNull();
    act(() => result.current.setDraft((f) => ({ ...f, name: 'Новое' })));
    let ok = false;
    await act(async () => { ok = await result.current.save(); });
    expect(ok).toBe(true);
    expect(saveMock.mock.calls[0][0].zonesCatalog).toBeNull();
  });

  it('строки зон нет — встроенный справочник зон', async () => {
    zonesRow = { exists: false, value: null };
    const { result } = await open();
    expect(result.current.zonesCatalog?.map((z) => z.id)).toContain('sleeve-l');
  });

  it('справочник флэтов не загрузился — error, сохранять нечего', async () => {
    flatsRow = null;
    const { result } = await open();
    expect(result.current.state).toBe('error');
    await act(async () => { expect(await result.current.save()).toBe(false); });
    expect(saveMock).not.toHaveBeenCalled();
  });
});

describe('useFlatEditor — правка и leaveGuard', () => {
  it('dirty при выбранном файле без правки полей; файл — геометрия, версия +1', async () => {
    const { result } = await open();
    expect(catalogHasUnsaved()).toBe(false);
    act(() => result.current.setFile('front', NEW_SVG));
    expect(result.current.dirty).toBe(true);
    expect(result.current.geometry).toBe(true);
    expect(result.current.nextVersion).toBe(2);
    expect(catalogHasUnsaved()).toBe(true);
    act(() => result.current.setFile('front', null));
    expect(result.current.dirty).toBe(false);
    expect(catalogHasUnsaved()).toBe(false);
  });

  it('размер справочника — в байтах UTF-8', async () => {
    const { result } = await open();
    const before = result.current.catalogBytes;
    act(() => result.current.setDraft((f) => ({ ...f, name: `${f.name}я` })));
    expect(result.current.catalogBytes - before).toBe(2);
  });

  it('размонтирование снимает отметку несохранённого', async () => {
    const { result, unmount } = await open();
    act(() => result.current.setDraft((f) => ({ ...f, name: 'Другое' })));
    expect(catalogHasUnsaved()).toBe(true);
    unmount();
    expect(catalogHasUnsaved()).toBe(false);
  });
});

describe('useFlatEditor — сохранение', () => {
  it('успех: база = записанное, файлы очищены, dirty снят', async () => {
    const released = { ...flat({ version: 2 }), history: [{ version: 1, views: flat().views }] };
    saveMock.mockResolvedValue(okResult(released, 2));
    const { result } = await open();
    act(() => result.current.setFile('front', NEW_SVG));
    await act(async () => { await result.current.save(); });
    const input = saveMock.mock.calls[0][0];
    expect(input.files).toEqual({ front: NEW_SVG });
    expect(input.rawBase).toBe(flatsRow!.value);
    expect(result.current.state).toBe('ready');
    expect(result.current.base).toBe(released);
    expect(result.current.files).toEqual({});
    expect(result.current.dirty).toBe(false);
  });

  it('конфликт: черновик на месте, save закрыт до reload; reload не очищает файлы', async () => {
    saveMock.mockResolvedValue({ ok: false, kind: 'conflict', message: 'Справочник изменён — загрузите свежую версию' });
    const { result } = await open();
    act(() => result.current.setDraft((f) => ({ ...f, name: 'Моя правка' })));
    act(() => result.current.setFile('back', NEW_SVG));
    await act(async () => { await result.current.save(); });
    expect(result.current.state).toBe('conflict');
    expect(result.current.draft?.name).toBe('Моя правка');
    saveMock.mockClear();
    await act(async () => { expect(await result.current.save()).toBe(false); });
    expect(saveMock).not.toHaveBeenCalled();

    const fresh = flat({ name: 'Чужая правка' });
    flatsRow = { exists: true, value: { version: 1, flats: [fresh] } };
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.base).toEqual(fresh);
    expect(result.current.files).toEqual({ back: NEW_SVG });
    expect(result.current.previousDraft?.name).toBe('Моя правка');
    saveMock.mockImplementation(async (i) => okResult(i.draft));
    await act(async () => { expect(await result.current.save()).toBe(true); });
    expect(saveMock.mock.calls[0][0].rawBase).toBe(flatsRow.value);
    expect(result.current.previousDraft).toBeNull();
  });

  it('отказ формы — error с текстом, повтор возможен; гонка номеров — следующий раз raceRetry', async () => {
    saveMock.mockResolvedValue({ ok: false, kind: 'files', message: MSG_VERSIONS_RACE });
    const { result } = await open();
    act(() => result.current.setFile('front', NEW_SVG));
    await act(async () => { await result.current.save(); });
    expect(result.current.state).toBe('error');
    expect(result.current.errorText).toBe(MSG_VERSIONS_RACE);
    await act(async () => { await result.current.save(); });
    expect(saveMock.mock.calls[0][0].raceRetry).toBe(false);
    expect(saveMock.mock.calls[1][0].raceRetry).toBe(true);
  });

  it('новый флэт: черновик создаёт экран; после успеха адрес flat=<id> заменён, повторного чтения нет', async () => {
    const { result } = await open('new');
    expect(result.current.state).toBe('ready');
    expect(result.current.draft).toBeNull();
    expect(result.current.dirty).toBe(false);
    const created = flat({ id: 'polo-new' });
    act(() => result.current.setDraft(() => clone(created)));
    expect(result.current.dirty).toBe(true);
    expect(result.current.geometry).toBe(true);
    saveMock.mockResolvedValue(okResult(created, 1));
    fetchMock.mockClear();
    await act(async () => { await result.current.save(); });
    expect(locations.at(-1)).toBe('/order-settings?tab=flats&flat=polo-new');
    expect(result.current.base).toBe(created);
    expect(result.current.reservedIds.has('polo-new')).toBe(true);
  });
});

describe('tolerantFlat', () => {
  it('не объект — флэт по умолчанию, снятый с подбора, без видов', () => {
    expect(tolerantFlat('мусор', 'x')).toMatchObject({ id: 'x', name: 'x', active: false, version: 1, views: [], sizes: [] });
  });

  it('виды вне перечня отбрасываются, история-массив сохраняется', () => {
    const f = tolerantFlat({ views: [{ kind: 'sleeve' }, { kind: 'back' }], history: [{ version: 1, views: [] }], version: 3 }, 'y');
    expect(f.views.map((v) => v.kind)).toEqual(['back']);
    expect(f.history).toEqual([{ version: 1, views: [] }]);
  });
});
