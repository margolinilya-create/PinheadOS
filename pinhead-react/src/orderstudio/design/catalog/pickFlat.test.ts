import { describe, it, expect } from 'vitest';
import { autoPickFlat, exactUpgrade, flatFitsModel, flatMismatch, flatsForModel, pickFlat } from './pickFlat';
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

describe('exactUpgrade — «появился точный силуэт» (5б, Р12)', () => {
  it('у позиции типовой, точный есть — предложить точный', () => {
    expect(exactUpgrade(item({ flat_id: 'tshirt-regular' }), TEE, catalog([regular, exact]))?.id).toBe('tshirt-exact');
  });

  it('уже точный, флэт не записан, точного нет, точный снят — null', () => {
    expect(exactUpgrade(item({ flat_id: 'tshirt-exact' }), TEE, catalog([regular, exact]))).toBeNull();
    expect(exactUpgrade(item(), TEE, catalog([regular, exact]))).toBeNull();
    expect(exactUpgrade(item({ flat_id: 'tshirt-regular' }), TEE, catalog([regular, oversize]))).toBeNull();
    expect(exactUpgrade(item({ flat_id: 'tshirt-regular' }), TEE, catalog([regular, { ...exact, active: false }]))).toBeNull();
  });

  it('записанный типовой снят — не предлагать (холст его и так не покажет)', () => {
    expect(exactUpgrade(item({ flat_id: 'tshirt-regular' }), TEE, catalog([{ ...regular, active: false }, exact]))).toBeNull();
  });
});

describe('B1 (веха 5в): код модели засчитывается только внутри её категории', () => {
  const HOODIE = { code: 'H-002', category: 'hoodies', fit: 'regular' as const };
  // Футболочный флэт, к которому по ошибке привязали код худи — живой случай «Худи Regular» на tshirt-freefit
  const teeWithHoodieCode = flat({ id: 'tshirt-freefit', categories: ['tshirts'], sku_codes: ['H-002'] });
  const hoodieItem = item({ sku_code: 'H-002' });

  it('флэт чужой категории не подходит модели, даже если в sku_codes её код', () => {
    expect(flatFitsModel(teeWithHoodieCode, hoodieItem, HOODIE)).toBe(false);
    expect(flatMismatch(teeWithHoodieCode, hoodieItem, HOODIE)).toBe(true);
  });

  it('автоподбор не берёт «точный» флэт чужой категории — берёт худи', () => {
    expect(autoPickFlat(hoodieItem, HOODIE, catalog([teeWithHoodieCode, hoodie]))?.flat.id).toBe('hoodie-regular');
  });

  it('флэт без категорий по коду подходит; модель неизвестна — не судим', () => {
    expect(flatFitsModel(exact, item(), TEE)).toBe(true);
    expect(flatMismatch(teeWithHoodieCode, hoodieItem, null)).toBe(false);
    expect(flatMismatch(null, hoodieItem, HOODIE)).toBe(false);
  });

  it('flatsForModel: только активные флэты, подходящие модели, по id; модель неизвестна — все активные', () => {
    const off = flat({ id: 'hoodie-off', categories: ['hoodies'], active: false });
    const cat = catalog([teeWithHoodieCode, hoodie, off, regular]);
    expect(flatsForModel(cat, hoodieItem, HOODIE).map((f) => f.id)).toEqual(['hoodie-regular']);
    expect(flatsForModel(cat, hoodieItem, null).map((f) => f.id)).toEqual(['hoodie-regular', 'tshirt-freefit', 'tshirt-regular']);
  });

  it('свойство: «модель сменилась» у pickFlat = flatMismatch записанного флэта', () => {
    const flats = [teeWithHoodieCode, hoodie, regular, oversize, exact];
    for (const stored of flats) {
      for (const [code, sku] of [['H-002', HOODIE], ['T-001', TEE]] as const) {
        const it2 = item({ sku_code: code, flat_id: stored.id });
        expect(pickFlat(it2, sku, catalog(flats)).modelChanged, `${stored.id} × ${code}`).toBe(flatMismatch(stored, it2, sku));
      }
    }
  });
});
