/**
 * Каталог моделей в Excel (`/sku`): выгрузка всех справочников и загрузка
 * моделей, тканей и отделки. Библиотека `window.XLSX` подключается страницей
 * (CDN в `index.html`), здесь — только разбор листов.
 *
 * Вынесено из `SkuEditor.jsx` (веха 8, задача 3): экран не растёт.
 */
import { toast } from '../../../store/useToastStore';

type Row = Record<string, unknown>;

interface Sheet { readonly __sheet?: never }

interface XlsxLib {
  utils: {
    book_new(): unknown;
    book_append_sheet(wb: unknown, sheet: Sheet, name: string): void;
    json_to_sheet(rows: Row[]): Sheet;
    sheet_to_json(sheet: Sheet): Row[];
  };
  writeFile(wb: unknown, name: string): void;
  read(data: ArrayBuffer): { Sheets: Record<string, Sheet | undefined> };
}

function xlsx(): XlsxLib | null {
  return (window as unknown as { XLSX?: XlsxLib }).XLSX ?? null;
}

export const XLSX_MISSING_TEXT = 'Excel недоступен: библиотека не загрузилась. Обновите страницу.';

/** Справочники для выгрузки — как их держит стор */
export interface ExcelCatalogs {
  skuCatalog: Row[];
  fabricsCatalog: Row[];
  trimCatalog: Row[];
  extrasCatalog: Row[];
  hardwareCatalog: Row[];
}

const list = (v: unknown): string => (Array.isArray(v) ? v.join(',') : '');
const text = (v: unknown): string => (v == null ? '' : String(v));
const orBlank = (v: unknown): unknown => (v ?? '');

/** Выгрузка `pinhead-sku-catalog.xlsx`: модели, ткани, отделка, обработки, фурнитура */
export function exportCatalogExcel(c: ExcelCatalogs): void {
  const X = xlsx();
  if (!X) { toast.error(XLSX_MISSING_TEXT); return; }
  const wb = X.utils.book_new();
  const add = (rows: Row[], name: string) => X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows), name);
  add(c.skuCatalog.map((s) => ({
    'Артикул': s.code, 'Название': s.name, 'Категория': s.category,
    'Fit': text(s.fit), 'Пошив ₽': s.sewingPrice, 'Расход осн. м': s.mainFabricUsage,
    'Отделка код': text(s.trimCode), 'Расход отд. м': s.trimUsage || 0,
    'Зоны': list(s.zones),
  })), 'SKU');
  add(c.fabricsCatalog.map((f) => ({
    'Код': f.code, 'Название': f.name, '₽ за пог. м': orBlank(f.priceRub), 'м/кг': orBlank(f.mPerKg),
    'Состав': text(f.composition), 'Плотность': orBlank(f.density),
    'Категории': list(f.forCategories), 'Поставщик': text(f.supplier),
  })), 'Ткани');
  add(c.trimCatalog.map((t) => ({
    'Код': t.code, 'Название': t.name, 'Поставщик': text(t.supplier), 'Вид': text(t.kind),
    'Цена ₽': orBlank(t.priceRub), 'Ед.': t.unit === 'pcs' ? 'шт' : 'м', 'м/кг': orBlank(t.mPerKg),
  })), 'Отделка');
  add(c.extrasCatalog.map((e) => ({ 'Код': e.code, 'Название': e.name, 'Цена ₽': e.price })), 'Обработки');
  add(c.hardwareCatalog.map((h) => ({ 'Код': h.code, 'Название': h.name, 'Цена ₽': h.price, 'Группа': h.group })), 'Фурнитура');
  X.writeFile(wb, 'pinhead-sku-catalog.xlsx');
}

const split = (v: unknown): string[] => text(v).split(',').filter(Boolean);

/** Листы книги → справочники стора (только те листы, что есть в файле) */
export function parseCatalogBook(X: XlsxLib, data: ArrayBuffer): Record<string, Row[]> {
  const wb = X.read(data);
  const out: Record<string, Row[]> = {};
  const rows = (name: string) => {
    const sheet = wb.Sheets[name];
    return sheet ? X.utils.sheet_to_json(sheet) : null;
  };
  const sku = rows('SKU');
  if (sku) {
    out.skuCatalog = sku.map((r) => ({
      code: text(r['Артикул']), name: text(r['Название']), category: text(r['Категория']) || 'tshirts',
      fit: text(r['Fit']) || 'regular', sewingPrice: Number(r['Пошив ₽']) || 200,
      mainFabricUsage: Number(r['Расход осн. м']) || 1.0,
      trimCode: text(r['Отделка код']) || null, trimUsage: Number(r['Расход отд. м']) || 0,
      mockupType: 'tee', zones: split(r['Зоны']),
    }));
  }
  const fabrics = rows('Ткани');
  if (fabrics) {
    // Только ₽ за метр: колонку «$ за метр» прежней выгрузки не читаем —
    // в ней лежала цена за кг (правка 13.10)
    out.fabricsCatalog = fabrics.map((r) => ({
      code: text(r['Код']), name: text(r['Название']),
      priceRub: Number(r['₽ за пог. м']) || 0, unit: 'm', mPerKg: Number(r['м/кг']) || null, priceUSD: 0,
      composition: text(r['Состав']), density: Number(r['Плотность']) || null,
      forCategories: split(r['Категории']), supplier: text(r['Поставщик']),
    }));
  }
  const trims = rows('Отделка');
  if (trims) {
    out.trimCatalog = trims.map((r) => ({
      code: text(r['Код']), name: text(r['Название']), supplier: text(r['Поставщик']),
      kind: text(r['Вид']) || null, priceRub: Number(r['Цена ₽']) || 0,
      unit: r['Ед.'] === 'шт' ? 'pcs' : 'm', mPerKg: Number(r['м/кг']) || null, priceUSD: 0,
    }));
  }
  return out;
}

/** Выбор файла и загрузка: каждый найденный лист — `setField(ключ, строки)` */
export function importCatalogExcel(setField: (key: string, value: Row[]) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const X = xlsx();
    if (!X) { toast.error(XLSX_MISSING_TEXT); return; }
    try {
      const parsed = parseCatalogBook(X, await file.arrayBuffer());
      for (const [key, value] of Object.entries(parsed)) setField(key, value);
    } catch (err) {
      console.error('[importCatalogExcel]', err);
      toast.error('Не удалось прочитать файл Excel');
    }
  };
  input.click();
}
