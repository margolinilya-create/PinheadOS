/**
 * ТЗ в PDF формирует СИСТЕМА (решение заказчика).
 *
 * Формат — docs/erp/tz-format-analysis.md: шапка заказа, изделие с техблоком,
 * размерная сетка, нанесения с параметрами, бирки, упаковка.
 *
 * ДОКУМЕНТ ПРИНАДЛЕЖИТ ПОЗИЦИИ (erp_tz_documents.item_id) — так его видят все
 * цеха её маршрута. Пишется именно в erp_tz_documents, а не во вложения:
 * лист закупки лежит вложением вида purchase СПЕЦИАЛЬНО, чтобы гейт ТЗ его
 * не засчитал; здесь наоборот — документ обязан попасть в таблицу, которую
 * гейт считает.
 *
 * ПОВТОРНАЯ СБОРКА — НОВАЯ ВЕРСИЯ, а не перезапись: правка ТЗ после запуска
 * обязана быть видна цеху бейджем «ТЗ обновлено». is_current снимается ПЕРЕД
 * вставкой новой — обратный порядок падает с 23505 на частичном индексе.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { PDFDocument, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1';
import { loadPdfFont } from '../_shared/pdfFont.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BUCKET = 'erp-attachments';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const fail = (message: string, status = 400) => json({ error: message }, status);

const PRODUCTION_TYPE: Record<string, string> = {
  no_product: 'Без изделий', ready_garment: 'Готовое изделие', cut: 'Крой',
  sewing: 'Пошив', samples: 'Образцы', outsource: 'Подряд',
};

const METHOD: Record<string, string> = {
  embroidery: 'Вышивка', silkscreen: 'Шелкография', dtf: 'ДТФ',
  dtg: 'DTG', heat_transfer: 'Термоперенос', other: 'Прочее',
};

const BRANDING_ON: Record<string, string> = { cut: 'на крое', finished: 'на готовом' };

const PACKAGING: Record<string, string> = {
  none: 'Нет', bopp: 'БОПП-пакет', zip: 'ZIP-пакет', other: 'Другое', inherit: 'Как в заказе',
};

const STICKERS: Record<string, string> = { none: 'Нет', blank: 'Бланк', other: 'Другое' };

const MATERIAL_ROLE: Record<string, string> = {
  main: 'Основное полотно', trim: 'Отделочное', lining: 'Подклад',
  hardware: 'Фурнитура', labels: 'Бирки', packaging: 'Упаковка', other: 'Другое',
};

function fmtDate(value: string | null): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

type GridRow = { color?: string; sizes?: Record<string, number> };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('Метод не поддерживается', 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return fail('Требуется авторизация', 401);

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await caller.auth.getUser();
  if (!userData?.user) return fail('Сессия не распознана', 401);

  const { data: isMember, error: memberErr } = await caller.rpc('erp_is_member');
  if (memberErr) return fail('Не удалось проверить доступ', 500);
  if (!isMember) return fail('Нет доступа к производственным заказам', 403);

  let payload: { order_id?: string };
  try {
    payload = await req.json();
  } catch {
    return fail('Тело запроса не разобрано');
  }
  const orderId = payload.order_id;
  if (!orderId) return fail('Не указан заказ');

  const { data: order, error: orderErr } = await caller
    .from('erp_orders')
    .select('id, bitrix_id, title, customer, manager, launch_date, due_date, notes,'
      + ' packaging, packaging_note, stickers, stickers_note, no_chestny_znak, tz_number')
    .eq('id', orderId)
    .maybeSingle();
  if (orderErr) return fail('Заказ не прочитан', 500);
  if (!order) return fail('Заказ не найден', 404);

  const { data: items } = await caller
    .from('erp_order_items')
    .select('id, product_type, variant, qty, production_type, branding_on, notes, size_grid,'
      + ' fit, trim_material, cutting_note, sewing_note, labels_note,'
      + ' packaging, packaging_size, sticker_place, marking_place, packaging_note, sort_order')
    .eq('order_id', orderId)
    .order('sort_order');
  const rows = items ?? [];
  if (rows.length === 0) return fail('В заказе нет позиций', 409);

  const { data: prints } = await caller
    .from('erp_item_prints')
    .select('item_id, seq, method, fabric, zone, width_mm, height_mm, offset_note, pantone, comment')
    .in('item_id', rows.map((i) => i.id))
    .order('seq');

  const { data: materials } = await caller
    .from('erp_materials')
    .select('item_id, role, name, color, article, qty_expected, unit')
    .eq('order_id', orderId);

  const font = await loadPdfFont();
  const admin = createClient(url, serviceKey);
  const created: Array<{ item_id: string; file_path: string; version: number }> = [];

  for (const item of rows) {
    const itemPrints = (prints ?? []).filter((p) => p.item_id === item.id);
    const itemMaterials = (materials ?? []).filter((m) => m.item_id === item.id || m.item_id === null);

    let pdfBytes: Uint8Array;
    try {
      const doc = await PDFDocument.create();
      doc.registerFontkit(fontkit);
      const embedded = await doc.embedFont(font, { subset: true });

      const A4: [number, number] = [595.28, 841.89];
      const margin = 40;
      const ink = rgb(0.1, 0.1, 0.1);
      const dim = rgb(0.45, 0.45, 0.45);

      let page = doc.addPage(A4);
      let y = A4[1] - margin;

      const text = (value: string, size: number, color = ink, indent = 0) => {
        page.drawText(value, { x: margin + indent, y, size, font: embedded, color });
      };
      const ensure = (need: number) => {
        if (y - need > margin) return;
        page = doc.addPage(A4);
        y = A4[1] - margin;
      };
      const line = (value: string, size = 9, color = ink, indent = 0) => {
        ensure(size + 6);
        text(value, size, color, indent);
        y -= size + 4;
      };
      const heading = (value: string) => {
        ensure(30);
        y -= 6;
        text(value, 11);
        y -= 16;
      };

      text('PINHEAD · ТЕХНИЧЕСКОЕ ЗАДАНИЕ', 16);
      y -= 22;
      text(`Заказ №${order.bitrix_id || '—'} · ${order.title}`, 11);
      y -= 15;
      if (order.tz_number) {
        text(`ТЗ ${order.tz_number}`, 9, dim);
        y -= 13;
      }
      text(`Клиент: ${order.customer || '—'}   Менеджер: ${order.manager || '—'}`, 9, dim);
      y -= 13;
      text(`Запуск: ${fmtDate(order.launch_date)}   Срок сдачи: ${fmtDate(order.due_date)}`, 9, dim);
      y -= 20;

      heading('ИЗДЕЛИЕ');
      line(`${item.product_type || '—'}${item.variant ? ` · ${item.variant}` : ''}`, 12);
      line(`Крой: ${item.fit || '—'}   Количество: ${item.qty} шт`
        + `   Производство: ${PRODUCTION_TYPE[item.production_type] ?? item.production_type}`);

      const grid = (item.size_grid ?? []) as GridRow[];
      if (Array.isArray(grid) && grid.length > 0) {
        heading('РАЗМЕРНАЯ СЕТКА');
        for (const row of grid) {
          const sizes = Object.entries(row.sizes ?? {})
            .filter(([, qty]) => Number(qty) > 0)
            .map(([size, qty]) => `${size}: ${qty}`)
            .join('   ');
          line(`${row.color || '—'} — ${sizes || 'нет размеров'}`);
        }
      }

      if (itemMaterials.length > 0) {
        heading('ПОЛОТНО И МАТЕРИАЛЫ');
        for (const m of itemMaterials) {
          line(`${MATERIAL_ROLE[m.role ?? ''] ?? m.role ?? 'Материал'}: ${m.name}`
            + `${m.color ? ` · цвет: ${m.color}` : ''}`
            + `${m.article ? ` · арт. ${m.article}` : ''}`
            + `${m.qty_expected ? ` · нужно ${m.qty_expected}${m.unit ? ` ${m.unit}` : ''}` : ''}`);
        }
      }

      const tech = [
        ['Отделочный материал', item.trim_material],
        ['Раскрой', item.cutting_note],
        ['Пошив', item.sewing_note],
        ['Бирки', item.labels_note],
      ].filter(([, v]) => v);
      if (tech.length > 0) {
        heading('ТЕХНИЧЕСКИЙ БЛОК');
        for (const [label, value] of tech) {
          const parts = String(value).split('\n').filter(Boolean);
          line(`${label}: ${parts[0]}`);
          for (const extra of parts.slice(1)) line(extra, 9, ink, 12);
        }
      }

      if (itemPrints.length > 0) {
        heading(`НАНЕСЕНИЯ (${BRANDING_ON[item.branding_on ?? ''] ?? '—'})`);
        itemPrints.forEach((p, index) => {
          ensure(60);
          line(`Нанесение №${index + 1} — ${METHOD[p.method] ?? p.method}`, 10);
          const size = p.width_mm && p.height_mm ? `${p.width_mm}×${p.height_mm} мм` : 'размер не задан';
          line(`Зона: ${p.zone || '—'}   Размер: ${size}`, 9, dim, 12);
          if (p.fabric) line(`На чём: ${p.fabric}`, 9, dim, 12);
          if (p.offset_note) line(`Отступ: ${p.offset_note}`, 9, dim, 12);
          if (p.pantone) line(`Pantone: ${p.pantone}`, 9, dim, 12);
          if (p.comment) line(`Комментарий: ${p.comment}`, 9, dim, 12);
        });
      }

      heading('УПАКОВКА И МАРКИРОВКА');
      const packaging = item.packaging && item.packaging !== 'inherit'
        ? item.packaging : order.packaging;
      line(`Упаковка: ${PACKAGING[packaging ?? 'none'] ?? packaging}`
        + `${item.packaging_size ? ` · размер пакета: ${item.packaging_size}` : ''}`);
      if (item.sticker_place) line(`Расположение стикера: ${item.sticker_place}`);
      if (item.marking_place) line(`Расположение маркировки: ${item.marking_place}`);
      if (item.packaging_note) line(`Требования: ${item.packaging_note}`);
      if (order.packaging_note) line(`По заказу: ${order.packaging_note}`, 9, dim);
      line(`Стикеры: ${STICKERS[order.stickers ?? 'none'] ?? order.stickers}`
        + `${order.stickers_note ? ` · ${order.stickers_note}` : ''}`);
      if (order.no_chestny_znak) line('Без Честного знака', 9);

      const notes = [item.notes, order.notes].filter(Boolean);
      if (notes.length > 0) {
        heading('ПРИМЕЧАНИЯ');
        for (const note of notes) {
          for (const part of String(note).split('\n').filter(Boolean)) line(part);
        }
      }

      pdfBytes = await doc.save();
    } catch (e) {
      console.error('[tz-pdf]', e);
      return fail('PDF не сформирован', 500);
    }

    const prefix = `tz/auto/${orderId}/${item.id}/`;
    const { data: existing } = await admin
      .from('erp_tz_documents')
      .select('id, group_id, version, is_current')
      .eq('order_id', orderId)
      .eq('item_id', item.id)
      .like('file_path', `${prefix}%`)
      .order('version', { ascending: false });

    const previous = existing?.[0] ?? null;
    const groupId = previous?.group_id ?? crypto.randomUUID();
    const version = (previous?.version ?? 0) + 1;
    const path = `${prefix}v${version}.pdf`;

    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) return fail(`Файл не сохранён: ${upErr.message}`, 500);

    if (previous) {
      await admin.from('erp_tz_documents')
        .update({ is_current: false })
        .eq('group_id', groupId)
        .eq('is_current', true);
    }

    const { error: rowErr } = await admin.from('erp_tz_documents').insert({
      order_id: orderId,
      item_id: item.id,
      group_id: groupId,
      version,
      is_current: true,
      file_path: path,
      file_name: `ТЗ · ${item.product_type || 'позиция'}.pdf`,
      mime_type: 'application/pdf',
      size_bytes: pdfBytes.byteLength,
      note: 'Сформировано системой из полей заказа',
    });
    if (rowErr) {
      await admin.storage.from(BUCKET).remove([path]);
      if (previous) {
        await admin.from('erp_tz_documents')
          .update({ is_current: true })
          .eq('id', previous.id);
      }
      return fail(`Файл сохранён, но не привязан к позиции: ${rowErr.message}`, 500);
    }

    created.push({ item_id: item.id, file_path: path, version });
  }

  return json({ ok: true, documents: created });
});
