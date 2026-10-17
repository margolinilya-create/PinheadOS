import { describe, it, expect } from 'vitest';
import { autoPickFlat, flatFitsModel, pickFlat } from './pickFlat';
import { catalog, flat } from '../fixtures.testutil';

const TEE = { code: 'T-001', category: 'tshirts', fit: 'regular' as const };
const item = (patch: Partial<{ flat_id: string; sku_code: string; fit: string }> = {}) =>
  ({ flat_id: '', sku_code: 'T-001', fit: '', ...patch });

const exact = flat({ id: 'tshirt-exact', typical: false, sku_codes: ['T-001'], categories: [], fits: [] });
const regular = flat({ id: 'tshirt-regular', fits: ['regular'] });
const oversize = flat({ id: 'tshirt-oversize', fits: ['oversize'] });
const hoodie = flat({ id: 'hoodie-regular', garment_type: 'hoodie', categories: ['hoodies'], fits: ['regular'] });

describe('pickFlat — порядок подбора', () => {
  it('точный флэт по коду модели — первым', () => {
    const r = pickFlat(item(), TEE, catalog([oversize, regular, exact]));
    expect(r).toMatchObject({ source: 'exact', modelChanged: false });
    expect(r.flat?.id).toBe('tshirt-exact');
  });

  it('типовой по категории и посадке', () => {
    const r = pickFlat(item(), TEE, catalog([oversize, regular, hoodie]));
    expect(r.source).toBe('typical-fit');
    expect(r.flat?.id).toBe('tshirt-regular');
  });

  it('посадка позиции важнее посадки модели', () => {
    expect(pickFlat(item({ fit: 'oversize' }), TEE, catalog([oversize, regular])).flat?.id).toBe('tshirt-oversize');
  });

  it('типовой только по категории, когда посадки нет', () => {
    const r = pickFlat(item(), { ...TEE, fit: 'classic' }, catalog([oversize, hoodie]));
    expect(r.source).toBe('typical-category');
    expect(r.flat?.id).toBe('tshirt-oversize');
  });

  it('нет подходящего — null', () => {
    expect(pickFlat(item(), { ...TEE, category: 'shorts' }, catalog([regular, hoodie]))).toEqual({
      flat: null, source: null, modelChanged: false, suggested: null,
    });
    expect(pickFlat(item({ sku_code: '' }), null, catalog([regular])).flat).toBeNull();
  });

  it('снятый флэт не подбирается — ни автоматически, ни из позиции', () => {
    const off = { ...regular, active: false };
    expect(pickFlat(item(), TEE, catalog([off])).flat).toBeNull();
    const r = pickFlat(item({ flat_id: 'tshirt-regular' }), TEE, catalog([off, oversize]));
    expect(r.flat?.id).toBe('tshirt-oversize');
    expect(r.source).toBe('typical-category');
  });

  it('флэт позиции важнее автоподбора, если подходит модели', () => {
    const r = pickFlat(item({ flat_id: 'tshirt-regular' }), TEE, catalog([exact, regular, oversize]));
    expect(r).toMatchObject({ source: 'item', modelChanged: false, suggested: null });
    expect(r.flat?.id).toBe('tshirt-regular');
  });

  it('автоподбор по категории → записали flat_id → модель не «сменилась»', () => {
    const classic = { ...TEE, fit: 'classic' as const };
    const cat = catalog([oversize, hoodie]);
    const first = pickFlat(item(), classic, cat);
    expect(first).toMatchObject({ source: 'typical-category', modelChanged: false });
    // тот же edit, что ставит нанесение, пишет flat_id
    const next = pickFlat(item({ flat_id: first.flat!.id }), classic, cat);
    expect(next).toEqual({ flat: first.flat, source: 'item', modelChanged: false, suggested: null });
  });

  it('явно выбранный силуэт другой посадки той же категории — без плашки, даже если есть «свой»', () => {
    const r = pickFlat(item({ flat_id: 'tshirt-oversize' }), TEE, catalog([regular, oversize]));
    expect(r).toEqual({ flat: oversize, source: 'item', modelChanged: false, suggested: null });
  });

  it('точный флэт другой модели, но той же категории — подходит (категория)', () => {
    const other = flat({ id: 'tshirt-other', typical: false, sku_codes: ['T-999'], fits: ['oversize'] });
    expect(pickFlat(item({ flat_id: 'tshirt-other' }), TEE, catalog([other, regular])).modelChanged).toBe(false);
  });

  it('точный флэт другой модели без категорий — «модель сменилась»', () => {
    const r = pickFlat(item({ flat_id: 'tshirt-exact', sku_code: 'T-002' }), TEE, catalog([exact, regular]));
    expect(r).toMatchObject({ source: 'item', modelChanged: true });
    expect(r.suggested?.id).toBe('tshirt-regular');
  });

  it('модель сменилась: флэт позиции остаётся, предложен новый силуэт', () => {
    const r = pickFlat(item({ flat_id: 'hoodie-regular' }), TEE, catalog([hoodie, regular]));
    expect(r.flat?.id).toBe('hoodie-regular');
    expect(r.modelChanged).toBe(true);
    expect(r.suggested?.id).toBe('tshirt-regular');
  });

  it('флэт позиции не найден в справочнике — автоподбор', () => {
    expect(pickFlat(item({ flat_id: 'gone' }), TEE, catalog([regular])).flat?.id).toBe('tshirt-regular');
  });

  it('при равенстве — меньший id, порядок справочника не важен', () => {
    const a = flat({ id: 'tshirt-a', fits: ['regular'] });
    const b = flat({ id: 'tshirt-b', fits: ['regular'] });
    expect(autoPickFlat(item(), TEE, catalog([b, a]))?.flat.id).toBe('tshirt-a');
    expect(autoPickFlat(item(), TEE, catalog([a, b]))?.flat.id).toBe('tshirt-a');
  });

  it('pickFlat не меняет справочник (сортировка — на копии)', () => {
    const cat = catalog([oversize, regular]);
    pickFlat(item(), TEE, cat);
    expect(cat.flats.map((f) => f.id)).toEqual(['tshirt-oversize', 'tshirt-regular']);
  });
});

describe('flatFitsModel', () => {
  it('точный по коду либо категория; посадка не сверяется', () => {
    expect(flatFitsModel(exact, item(), TEE)).toBe(true);
    expect(flatFitsModel(regular, item(), TEE)).toBe(true);
    expect(flatFitsModel(oversize, item(), TEE)).toBe(true); // посадка — не условие, только предпочтение подбора
    expect(flatFitsModel(exact, item({ sku_code: 'T-002' }), TEE)).toBe(false);
    expect(flatFitsModel(regular, item(), null)).toBe(false);
    expect(flatFitsModel(hoodie, item(), TEE)).toBe(false);
  });
});
