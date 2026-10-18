import { describe, it, expect, vi } from 'vitest';
import { newSalesItem, newSalesLabel, newSalesOrder, newSalesPrint } from '../model/factory';
import type { SalesItem, SalesOrder } from '../model/types';
import { ERP_DUPLICATE_REASON, ERP_FILE_MAX_BYTES, isErpFileKey } from '../api/erpFiles';
import { sanitizeSvg } from '../design/assets/sanitizeSvg';
import { tzToErpDraft } from './tzToErpDraft';
import {
  checkAttachedCount, copyLaunchFiles, declaredOf, planLaunchFiles, sniffBytes, type CopyDeps,
} from './launchFiles';

/**
 * Шаг `files` запуска (К12): план копий и копирование в `erp-attachments`.
 * Сеть замокана зависимостями: проверяется, ЧТО и С КАКИМ ТИПОМ уходит в
 * публичный бакет, а не сам Storage (его сторожат `erpFiles.test.ts` и e2e).
 */
const ORDER_ID = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const ART = (name: string) => `orders/${ORDER_ID}/logo/${name}`;
const TZ = `orders/${ORDER_ID}/tz/aaaa-PH-1234-g12345678-c123456789ab-tee.pdf`;

const enc = new TextEncoder();
const PDF = enc.encode('%PDF-1.7\n%…');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const SVG_SCRIPT = enc.encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>');
const SVG_DOCTYPE = enc.encode('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>');
const HTML = enc.encode('<html><script>alert(1)</script></html>');

function ids() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

const grid = (qty: number) => ({ sizes: ['M'], rows: [{ color: 'Чёрный', sizes: { M: qty } }] });

function item(patch: Partial<SalesItem> = {}): SalesItem {
  return newSalesItem({ product_type: 'Футболка', size_grid: grid(10), tz_pdf_path: TZ, ...patch });
}

function order(items: SalesItem[]): SalesOrder {
  return newSalesOrder({ id: ORDER_ID, number: 'PH-1234', status: 'ready_to_launch', items });
}

/** Позиции, которые уходят в createOrder: как `payloadItems` ERP — с видом изделия и количеством */
const valid = (o: SalesOrder) => tzToErpDraft(o).items.filter((d) => d.product_type.trim() && Number(d.qty) > 0);

function deps(files: Record<string, Uint8Array | Blob>, upload = vi.fn(async (path: string, body: Blob, _type: string) => ({ ok: true as const, path, size: body.size }))) {
  const download = vi.fn(async (_id: string, path: string) => {
    const f = files[path];
    if (!f) return null;
    return f instanceof Blob ? f : new Blob([f as BlobPart], { type: 'image/png' });
  });
  const d: CopyDeps = { download, upload, sanitize: (t) => sanitizeSvg(t) };
  return { d, download, upload };
}

describe('sniffBytes / declaredOf', () => {
  it('тип только по байтам; расширение — только объявленный вид', () => {
    expect(sniffBytes(PDF)).toBe('pdf');
    expect(sniffBytes(PNG)).toBe('png');
    expect(sniffBytes(JPEG)).toBe('jpeg');
    expect(sniffBytes(enc.encode('%!PS-Adobe-3.0'))).toBe('ps');
    expect(sniffBytes(SVG_SCRIPT)).toBe('svg');
    expect(sniffBytes(HTML)).toBeNull();
    expect(declaredOf('a/b.AI')).toBe('pdf');
    expect(declaredOf('a/b.jpeg')).toBe('raster');
    expect(declaredOf('a/b.psd')).toBe('other');
  });
});

describe('planLaunchFiles', () => {
  it('копия ТЗ на каждую позицию ERP с разными groupId и ключами без id заказа', () => {
    const o = order([item(), item({ size_grid: grid(5) })]);
    const plan = planLaunchFiles(o, valid(o), ids());
    expect(plan.tz).toHaveLength(2);
    expect(new Set(plan.tz.map((t) => t.groupId)).size).toBe(2);
    expect(new Set(plan.tz.map((t) => t.key)).size).toBe(2);
    for (const t of plan.tz) {
      expect(isErpFileKey(t.key)).toBe(true);
      expect(t.key).not.toContain(ORDER_ID);
      expect(t.source).toBe(TZ);
    }
  });

  it('позиция без количества не получает ТЗ; item_index — по ключу в позициях payload', () => {
    const a = item({ prints: [newSalesPrint({ method: 'dtf', artwork_path: ART('a.png') })] });
    const empty = item({ size_grid: grid(0) });
    const c = item({ product_type: 'Худи', prints: [newSalesPrint({ method: 'dtf', artwork_path: ART('c.png') })] });
    const o = order([a, empty, c]);
    const plan = planLaunchFiles(o, valid(o), ids());
    expect(plan.tz.map((t) => [t.itemKey, t.itemIndex])).toEqual([[a.key, 0], [c.key, 1]]);
    expect(plan.att.find((x) => x.itemKey === c.key)?.itemIndex).toBe(1);
  });

  it('PDF/AI-макет → исходник и необязательное .preview.png; ключ нанесения — из draftItems', () => {
    const p = newSalesPrint({ method: 'silkscreen', artwork_path: ART('logo.ai') });
    const o = order([item({ prints: [p] })]);
    const draft = valid(o);
    const plan = planLaunchFiles(o, draft, ids());
    expect(plan.att.map((x) => [x.source, x.declared, !!x.optional])).toEqual([
      [ART('logo.ai'), 'pdf', false],
      [`${ART('logo.ai')}.preview.png`, 'raster', true],
    ]);
    for (const x of plan.att) expect(x.printKey).toBe(draft[0].prints[0].key);
  });

  it('нанесение без макета («прочее») не копируется; бирка с превью → label_key', () => {
    const l = newSalesLabel({ preview_paths: [ART('label.jpg')] });
    const o = order([item({ prints: [newSalesPrint({ method: 'other' })], labels: [l] })]);
    const draft = valid(o);
    const plan = planLaunchFiles(o, draft, ids());
    expect(plan.att).toHaveLength(1);
    expect(plan.att[0]).toMatchObject({ kind: 'label', labelKey: draft[0].labels[0].key, declared: 'raster' });
    expect(plan.att[0].printKey).toBeUndefined();
  });
});

describe('copyLaunchFiles', () => {
  it('PDF группы скачан один раз на N копий, у каждой своя строка tz.documents', async () => {
    const o = order([item(), item({ size_grid: grid(5) }), item({ size_grid: grid(7) })]);
    const plan = planLaunchFiles(o, valid(o), ids());
    const { d, download, upload } = deps({ [TZ]: PDF });
    const r = await copyLaunchFiles(o, plan, 'u-ms', d);
    expect(r.ok).toBe(true);
    expect(download).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(3);
    if (!r.ok) return;
    expect(r.tzDocs.map((t) => t.item_index)).toEqual([0, 1, 2]);
    expect(r.tzDocs[0]).toMatchObject({ mime_type: 'application/pdf', uploaded_by: 'u-ms', size_bytes: PDF.length });
    for (const call of upload.mock.calls) expect(call[2]).toBe('application/pdf');
  });

  it('ТЗ без %PDF- — отказ, в бакет ничего', async () => {
    const o = order([item()]);
    const { d, upload } = deps({ [TZ]: HTML });
    const r = await copyLaunchFiles(o, planLaunchFiles(o, valid(o), ids()), 'u', d);
    expect(r).toEqual({ ok: false, reason: 'ТЗ позиции «Футболка» не PDF — верните менеджеру, он отправит заново' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('409 у писателя — отказ «уже есть в производстве», не успех', async () => {
    const o = order([item()]);
    const upload = vi.fn(async () => ({ ok: false as const, reason: ERP_DUPLICATE_REASON }));
    const { d } = deps({ [TZ]: PDF }, upload as never);
    const r = await copyLaunchFiles(o, planLaunchFiles(o, valid(o), ids()), 'u', d);
    expect(r).toEqual({ ok: false, reason: ERP_DUPLICATE_REASON });
  });

  it('SVG под именем .png (Blob.type image/png) — отказ по байтам, тип не из Blob.type', async () => {
    const o = order([item({ prints: [newSalesPrint({ method: 'dtf', artwork_path: ART('logo.png') })] })]);
    const { d, upload } = deps({ [TZ]: PDF, [ART('logo.png')]: SVG_SCRIPT });
    const r = await copyLaunchFiles(o, planLaunchFiles(o, valid(o), ids()), 'u', d);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reason).toMatch(/нанесения 1 «Футболка».*не совпадает/);
    expect(upload.mock.calls.map((c) => c[2])).toEqual(['application/pdf']);
  });

  it('HTML-байты под .pdf — отказ с номером нанесения', async () => {
    const o = order([item({ prints: [newSalesPrint(), newSalesPrint({ method: 'dtf', artwork_path: ART('x.pdf') })] })]);
    const { d } = deps({ [TZ]: PDF, [ART('x.pdf')]: HTML });
    const r = await copyLaunchFiles(o, planLaunchFiles(o, valid(o), ids()), 'u', d);
    expect(r.ok ? '' : r.reason).toMatch(/нанесения 2 «Футболка»/);
  });

  it('больше 20 МБ — отказ с названием нанесения', async () => {
    const o = order([item({ prints: [newSalesPrint({ method: 'dtf', artwork_path: ART('big.png') })] })]);
    const big = new Blob([new Uint8Array(ERP_FILE_MAX_BYTES + 1)]);
    const { d } = deps({ [TZ]: PDF, [ART('big.png')]: big });
    const r = await copyLaunchFiles(o, planLaunchFiles(o, valid(o), ids()), 'u', d);
    expect(r).toEqual({
      ok: false,
      reason: 'Файл макета нанесения 1 «Футболка» больше 20 МБ — производство его не примет. Верните заказ менеджеру, чтобы он заменил файл',
    });
  });

  it('SVG со <script> — в бакет уходит очищенный текст с типом image/svg+xml', async () => {
    const o = order([item({ prints: [newSalesPrint({ method: 'dtf', artwork_path: ART('logo.svg') })] })]);
    const { d, upload } = deps({ [TZ]: PDF, [ART('logo.svg')]: SVG_SCRIPT });
    const r = await copyLaunchFiles(o, planLaunchFiles(o, valid(o), ids()), 'u', d);
    expect(r.ok).toBe(true);
    const call = upload.mock.calls.find((c) => c[2] === 'image/svg+xml');
    expect(call).toBeDefined();
    const text = await (call![1] as Blob).text();
    expect(text).toContain('<rect');
    expect(text).not.toContain('script');
    expect(call![0]).toMatch(/\.svg$/);
  });

  it('неочищаемый SVG без превью — отказ', async () => {
    const o = order([item({ prints: [newSalesPrint({ method: 'dtf', artwork_path: ART('bad.svg') })] })]);
    const { d } = deps({ [TZ]: PDF, [ART('bad.svg')]: SVG_DOCTYPE });
    const r = await copyLaunchFiles(o, planLaunchFiles(o, valid(o), ids()), 'u', d);
    expect(r.ok ? '' : r.reason).toMatch(/^SVG макета нанесения 1 «Футболка» не прошёл очистку/);
  });

  it('PDF-макет: исходник и превью; превью нет в бакете — не отказ; ключи нанесения в attachments', async () => {
    const a = item({ prints: [newSalesPrint({ method: 'dtf', artwork_path: ART('a.pdf') })] });
    const c = item({ product_type: 'Худи', prints: [newSalesPrint({ method: 'dtf', artwork_path: ART('c.jpg') })] });
    const o = order([a, item({ size_grid: grid(0) }), c]);
    const draft = valid(o);
    const { d } = deps({ [TZ]: PDF, [ART('a.pdf')]: PDF, [ART('c.jpg')]: JPEG });
    const r = await copyLaunchFiles(o, planLaunchFiles(o, draft, ids()), 'u', d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attachments.map((x) => [x.item_index, x.print_key, x.kind, x.file_path.split('.').pop()])).toEqual([
      [0, draft[0].prints[0].key, 'print', 'pdf'],
      [1, draft[1].prints[0].key, 'print', 'jpg'],
    ]);
    expect(r.attachments[1].file_name).toMatch(/^PH-1234-Hudi-nanesenie\.jpg$/);
  });

  it('формат, который производство не принимает (PSD), — отказ с названием', async () => {
    const o = order([item({ prints: [newSalesPrint({ method: 'dtf', artwork_path: ART('x.psd') })] })]);
    const { d } = deps({ [TZ]: PDF });
    const r = await copyLaunchFiles(o, planLaunchFiles(o, valid(o), ids()), 'u', d);
    expect(r.ok ? '' : r.reason).toMatch(/^Файл макета нанесения 1 «Футболка» в формате/);
  });
});

describe('checkAttachedCount', () => {
  it('стор ERP выбросил вложение с неизвестным ключом — предупреждение', () => {
    const sent = [{ kind: 'print' }, { kind: 'label' }, { kind: 'print' }] as never;
    expect(checkAttachedCount(sent, [{ kind: 'print' }, { kind: 'tech' }])).toBe('2 макета не привязались к нанесениям и биркам — проверьте в производстве');
    expect(checkAttachedCount(sent, [{ kind: 'print' }, { kind: 'print' }, { kind: 'label' }])).toBeNull();
    expect(checkAttachedCount([{ kind: 'print' }] as never, [])).toBe('1 макет не привязался к нанесениям и биркам — проверьте в производстве');
  });
});
