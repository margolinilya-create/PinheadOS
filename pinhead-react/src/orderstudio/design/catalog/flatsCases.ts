/**
 * Общий набор случаев справочника флэтов (проверка скиллами, техдолг: «правила
 * справочника — общий набор случаев для zod и проб, без TS-зеркала»).
 *
 * Каждый случай — значение `app_config.garmentFlats` и ожидание: принимает ли
 * его справочник. Клиент (`flatsSchema`) прогоняет все случаи в тесте; серверная
 * `catalog_value_check` (миграция H) обязана отвечать так же — пробы
 * `supabase/probes/garment_flats.sql` называют случаи теми же именами
 * (`name`), код отказа сервера — 22023.
 *
 * Приложение модуль не импортирует: это данные для тестов и проб.
 */
import type { GarmentFlatsCatalog } from '../types';

export interface FlatsCase {
  name: string;
  /** Что проверяет случай — по-русски */
  note: string;
  value: unknown;
  ok: boolean;
}

/** Корректный справочник: один типовой флэт футболки, перед и спина */
export function validFlatsCatalog(): GarmentFlatsCatalog {
  const area = (id: string, zone: string | null, poly: [number, number][]) =>
    ({ id, name: id === 'label' ? 'Этикетка' : 'Грудь', zone_id: zone, polygon_mm: poly, safe_inset_mm: 5 });
  return {
    version: 1,
    flats: [{
      id: 'tshirt-regular',
      name: 'Футболка Regular',
      garment_type: 'tshirt',
      typical: true,
      active: true,
      version: 1,
      sku_codes: [],
      categories: ['tshirts'],
      fits: ['regular'],
      base_size: 'M',
      sizes: ['M'],
      views: [
        {
          kind: 'front',
          svg_path: 'flats/tshirt-regular/v1/front.svg',
          scale_mm_per_unit: 1,
          anchors: { neckline_point: { x: 300, y: 92 }, center_axis_x: 300 },
          print_areas: [area('chest', 'front', [[150, 140], [450, 140], [450, 540], [150, 540]])],
        },
        {
          kind: 'back',
          svg_path: 'flats/tshirt-regular/v1/back.svg',
          scale_mm_per_unit: 1,
          anchors: { neckline_point: { x: 300, y: 40 }, center_axis_x: 300 },
          print_areas: [
            area('back', 'back', [[150, 100], [450, 100], [450, 500], [150, 500]]),
            area('label', null, [[260, 48], [340, 48], [340, 80], [260, 80]]),
          ],
        },
      ],
    }],
  };
}

type Mut = (c: GarmentFlatsCatalog & { flats: Record<string, unknown>[] }) => unknown;

function variant(mut: Mut): unknown {
  const c = JSON.parse(JSON.stringify(validFlatsCatalog()));
  const r = mut(c);
  return r === undefined ? c : r;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- порча образца по произвольному пути */
const f0 = (c: any) => c.flats[0];
const front = (c: any) => c.flats[0].views[0];
const chest = (c: any) => c.flats[0].views[0].print_areas[0];

export const FLATS_CASES: FlatsCase[] = [
  { name: 'valid', note: 'образец', value: validFlatsCatalog(), ok: true },
  { name: 'not_object', note: 'не объект', value: ['flats'], ok: false },
  { name: 'version_2', note: 'версия справочника не 1', value: variant((c: any) => { c.version = 2; }), ok: false },
  { name: 'dup_id', note: 'два флэта с одним id', value: variant((c: any) => { c.flats.push(JSON.parse(JSON.stringify(f0(c)))); }), ok: false },
  { name: 'bad_id', note: 'id с заглавной и пробелом', value: variant((c: any) => { f0(c).id = 'Tshirt X'; }), ok: false },
  { name: 'foreign_path', note: 'svg_path чужого флэта', value: variant((c: any) => { front(c).svg_path = 'flats/hoodie-regular/v1/front.svg'; }), ok: false },
  { name: 'dotdot_path', note: 'svg_path с ../', value: variant((c: any) => { front(c).svg_path = 'flats/tshirt-regular/v1/../../x/front.svg'; }), ok: false },
  { name: 'version_0', note: 'версия флэта 0', value: variant((c: any) => { f0(c).version = 0; }), ok: false },
  { name: 'version_10000', note: 'версия флэта больше 9999', value: variant((c: any) => { f0(c).version = 10000; }), ok: false },
  { name: 'dup_view', note: 'вид повторяется', value: variant((c: any) => { f0(c).views[1].kind = 'front'; f0(c).views[1].svg_path = 'flats/tshirt-regular/v1/front.svg'; }), ok: false },
  { name: 'view_sleeve', note: 'вид не из перечня', value: variant((c: any) => { front(c).kind = 'sleeve'; }), ok: false },
  { name: 'scale_0', note: 'масштаб 0', value: variant((c: any) => { front(c).scale_mm_per_unit = 0; }), ok: false },
  { name: 'scale_11', note: 'масштаб больше 10', value: variant((c: any) => { front(c).scale_mm_per_unit = 11; }), ok: false },
  { name: 'no_areas', note: 'вид без зон', value: variant((c: any) => { front(c).print_areas = []; }), ok: false },
  { name: 'dup_area', note: 'зона повторяется в виде', value: variant((c: any) => { f0(c).views[1].print_areas[1].id = 'back'; }), ok: false },
  { name: 'polygon_2', note: 'полигон из двух точек', value: variant((c: any) => { chest(c).polygon_mm = [[0, 0], [10, 10]]; }), ok: false },
  { name: 'polygon_257', note: 'полигон больше 256 точек', value: variant((c: any) => { chest(c).polygon_mm = Array.from({ length: 257 }, (_, i) => [i, i % 2 ? 0 : 100]); }), ok: false },
  { name: 'coord_5001', note: '|координата| больше 5000', value: variant((c: any) => { chest(c).polygon_mm[1][0] = 5001; }), ok: false },
  { name: 'coord_string', note: 'координата строкой', value: variant((c: any) => { chest(c).polygon_mm[1][0] = '450'; }), ok: false },
  { name: 'method_screenprint', note: 'техника DM, не наша', value: variant((c: any) => { chest(c).methods = ['screenprint']; }), ok: false },
  { name: 'default_not_in_methods', note: 'техника по умолчанию вне допустимых', value: variant((c: any) => { chest(c).methods = ['dtf']; chest(c).default_method = 'embroidery'; }), ok: false },
  { name: 'methods_ok', note: 'допустимые техники и техника по умолчанию из них', value: variant((c: any) => { chest(c).methods = ['dtf', 'dtg']; chest(c).default_method = 'dtg'; }), ok: true },
  { name: 'zone_id_bad', note: 'zone_id не строка-код', value: variant((c: any) => { chest(c).zone_id = 'Грудь'; }), ok: false },
  { name: 'name_201', note: 'имя длиннее 200', value: variant((c: any) => { f0(c).name = 'ф'.repeat(201); }), ok: false },
  { name: 'active_string', note: 'active не boolean', value: variant((c: any) => { f0(c).active = 'true'; }), ok: false },
  { name: 'no_neckline', note: 'у переда одежды нет горловины', value: variant((c: any) => { delete front(c).anchors.neckline_point; }), ok: false },
  { name: 'shopper_no_neckline', note: 'у шоппера горловины может не быть', value: variant((c: any) => { f0(c).garment_type = 'shopper'; delete front(c).anchors.neckline_point; }), ok: true },
  // ── Веха 5б (задача 1): история, строки ТЗ, коды моделей, рукава — имена повторяют пробы `flats_admin.sql`
  { name: 'history_ok', note: 'версия 2 с историей версии 1', value: variant((c: any) => { releaseTo2(c); }), ok: true },
  { name: 'tz_row_ok', note: 'строка ТЗ из перечня', value: variant((c: any) => { chest(c).tz_row = 'front_l'; }), ok: true },
  { name: 'sku_dup_inactive_ok', note: 'код модели у активного и у снятого флэта', value: variant((c: any) => { twoFlats(c, false); }), ok: true },
  { name: 'sleeve_ok', note: 'левый рукав с низом и центром рукава', value: variant((c: any) => { f0(c).views.push(sleeveView()); }), ok: true },
  { name: 'history_path_foreign', note: 'путь записи истории с версией текущей', value: variant((c: any) => { releaseTo2(c); hist0(c).views[0].svg_path = 'flats/tshirt-regular/v2/front.svg'; }), ok: false },
  { name: 'history_path_other_flat', note: 'путь записи истории — другой флэт той же версии', value: variant((c: any) => { releaseTo2(c); hist0(c).views[0].svg_path = 'flats/hoodie-regular/v1/front.svg'; }), ok: false },
  { name: 'history_path_traversal', note: 'путь записи истории с ../', value: variant((c: any) => { releaseTo2(c); hist0(c).views[0].svg_path = 'flats/tshirt-regular/v1/../v1/front.svg'; }), ok: false },
  { name: 'history_version_ge', note: 'версия записи истории не меньше текущей', value: variant((c: any) => { releaseTo2(c); hist0(c).version = 2; }), ok: false },
  { name: 'history_dup_version', note: 'две записи истории одной версии', value: variant((c: any) => { releaseTo2(c); f0(c).version = 3; repath(f0(c).views, 3); f0(c).history.push(JSON.parse(JSON.stringify(hist0(c)))); }), ok: false },
  { name: 'history_bad_view', note: 'зона в записи истории из двух точек', value: variant((c: any) => { releaseTo2(c); hist0(c).views[0].print_areas[0].polygon_mm = [[0, 0], [10, 10]]; }), ok: false },
  { name: 'tz_row_bad', note: 'строка ТЗ не из перечня', value: variant((c: any) => { chest(c).tz_row = 'Полочка'; }), ok: false },
  { name: 'sku_dup_active', note: 'код модели у двух активных флэтов', value: variant((c: any) => { twoFlats(c, true); }), ok: false },
  { name: 'sku_code_65', note: 'код модели длиннее 64', value: variant((c: any) => { f0(c).sku_codes = ['T'.repeat(65)]; }), ok: false },
  { name: 'garment_type_bad', note: 'тип изделия не из перечня', value: variant((c: any) => { f0(c).garment_type = 'dress'; }), ok: false },
  { name: 'typical_missing', note: 'нет признака «типовой»', value: variant((c: any) => { delete f0(c).typical; }), ok: false },
  { name: 'sleeve_no_anchor', note: 'у рукава нет центра рукава', value: variant((c: any) => { const v = sleeveView(); delete v.anchors.sleeve_center_x; f0(c).views.push(v); }), ok: false },
  { name: 'front_no_axis', note: 'у переда нет оси центра', value: variant((c: any) => { delete front(c).anchors.center_axis_x; }), ok: false },
  { name: 'inset_negative', note: 'отрицательный безопасный отступ', value: variant((c: any) => { chest(c).safe_inset_mm = -1; }), ok: false },
];

/** Пути видов — на версию `v` */
function repath(views: any[], v: number): void {
  for (const view of views) view.svg_path = String(view.svg_path).replace(/\/v\d+\//, `/v${v}/`);
}

/** Выпуск версии 2: прежние виды — в историю как есть, текущие — по путям v2 */
function releaseTo2(c: any): void {
  const flat = f0(c);
  flat.history = [{ version: 1, views: JSON.parse(JSON.stringify(flat.views)) }];
  flat.version = 2;
  repath(flat.views, 2);
}

function hist0(c: any): any {
  return c.flats[0].history[0];
}

/** Второй флэт с тем же кодом модели T-006; `active` — снят ли он */
function twoFlats(c: any, active: boolean): void {
  f0(c).sku_codes = ['T-006'];
  const other = JSON.parse(JSON.stringify(f0(c)));
  other.id = 'tshirt-oversize';
  other.active = active;
  for (const v of other.views) v.svg_path = String(v.svg_path).replace('tshirt-regular', 'tshirt-oversize');
  c.flats.push(other);
}

function sleeveView(): any {
  return {
    kind: 'sleeve_left',
    svg_path: 'flats/tshirt-regular/v1/sleeve_left.svg',
    scale_mm_per_unit: 1,
    anchors: { sleeve_bottom_y: 500, sleeve_center_x: 150 },
    print_areas: [{ id: 'sleeve', name: 'Левый рукав', zone_id: 'sleeve-l', tz_row: 'sleeve_l', polygon_mm: [[100, 100], [200, 100], [200, 300], [100, 300]], safe_inset_mm: 5 }],
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
