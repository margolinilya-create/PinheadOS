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
];
/* eslint-enable @typescript-eslint/no-explicit-any */
