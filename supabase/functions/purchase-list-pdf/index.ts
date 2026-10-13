/**
 * PDF листа закупки (правки заказчика 16.08, п. 15).
 *
 * ЧТО ТРЕБУЕТ ДОКУМЕНТ ДОСЛОВНО: «Лист закупки должен АВТОМАТИЧЕСКИ формироваться
 * системой в PDF. Менеджер не должен отдельно вручную делать PDF и потом
 * загружать его. Сформированный лист должен храниться в документах заказа
 * рядом с ТЗ». Печатная страница браузера (`/orders/:id/purchase-list`)
 * закрывает только просмотр и печать: файла она не создаёт и никуда не кладёт.
 *
 * ПОЧЕМУ СЕРВЕР, А НЕ БРАУЗЕР (решение заказчика 16.08). Оболочка ERP занимает
 * 97 % бюджета критического пути, и PDF-библиотека в клиенте стоила бы ещё
 * 100–200 кБ. Но главное — в браузере файл всё равно делал бы ЧЕЛОВЕК нажатием
 * кнопки, то есть слово «автоматически» осталось бы невыполненным.
 *
 * ГЛАВНАЯ СЛОЖНОСТЬ ЗДЕСЬ — НЕ ГЕНЕРАЦИЯ, А ШРИФТ. Четырнадцать стандартных
 * шрифтов PDF кодируют текст в WinAnsi и кириллицы не знают ВООБЩЕ: `drawText`
 * с русской строкой либо бросает, либо рисует мусор. Поэтому шрифт с кириллицей
 * встраивается в документ (DejaVu Sans, свободная лицензия), а `fontkit`
 * подключается явно — без него `embedFont` не принимает TTF.
 *
 * Шрифт кэшируется в памяти инстанса: холодный старт тянет его один раз,
 * последующие вызовы берут готовый. Падение загрузки шрифта — это отказ всей
 * операции, а не «сделаем без кириллицы»: PDF с мусором вместо названий
 * материалов хуже отсутствующего.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { PDFDocument, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FONT_URL = 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf';
const BUCKET = 'erp-attachments';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const fail = (message: string, status = 400) => json({ error: message }, status);

/** Шрифт живёт в памяти инстанса: холодный старт тянет его один раз */
let fontCache: Uint8Array | null = null;

async function loadFont(): Promise<Uint8Array> {
  if (fontCache) return fontCache;
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`шрифт не загрузился: ${res.status}`);
  fontCache = new Uint8Array(await res.arrayBuffer());
  return fontCache;
}

const MATERIAL_KIND: Record<string, string> = {
  fabric: 'Ткань',
  trim: 'Отделка',
  hardware: 'Фурнитура',
  labels: 'Бирки',
  packaging: 'Упаковка',
  other: 'Другое',
};

const MATERIAL_ROLE: Record<string, string> = {
  main: 'Основной',
  trim: 'Отделочный',
  contrast: 'Контрастный',
  lining: 'Подклад',
};

function fmtDate(value: string | null): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('Метод не поддерживается', 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return fail('Требуется авторизация', 401);

  /**
   * Личность — из ТОКЕНА, а не из тела запроса, и права — тоже: вызов
   * `erp_is_member()` идёт от лица вызывающего, то есть той же функцией,
   * на которой стоят политики таблиц заказа. Своя проверка роли разошлась бы
   * с политикой в первую же её правку.
   */
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

  /**
   * Данные читаем ОТ ЛИЦА ВЫЗЫВАЮЩЕГО (клиент `caller`), а не сервисным ключом:
   * право видеть заказ проверяет RLS, и обходить её ради удобства значит
   * позволить сформировать лист закупки по чужому заказу.
   */
  const { data: order, error: orderErr } = await caller
    .from('erp_orders')
    .select('id, bitrix_id, title, customer, manager, launch_date, due_date')
    .eq('id', orderId)
    .maybeSingle();
  if (orderErr) return fail('Заказ не прочитан', 500);
  if (!order) return fail('Заказ не найден', 404);

  const { data: materials } = await caller
    .from('erp_materials')
    .select('id, kind, role, name, color, article, qty_expected, unit, manager_note, item_id')
    .eq('order_id', orderId)
    .order('created_at');

  const rows = materials ?? [];
  if (rows.length === 0) return fail('В заказе нет листа закупки', 409);

  const { data: items } = await caller
    .from('erp_order_items')
    .select('id, product_type, variant')
    .eq('order_id', orderId);
  const itemById = new Map((items ?? []).map((i) => [i.id, i]));

  // --- Сборка документа -------------------------------------------------------

  let pdfBytes: Uint8Array;
  try {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(await loadFont(), { subset: true });

    const A4: [number, number] = [595.28, 841.89];
    const margin = 40;
    const ink = rgb(0.1, 0.1, 0.1);
    const dim = rgb(0.45, 0.45, 0.45);

    let page = doc.addPage(A4);
    let y = A4[1] - margin;

    const text = (value: string, size: number, color = ink, indent = 0) => {
      page.drawText(value, { x: margin + indent, y, size, font, color });
    };
    /** Новая страница, когда до низа осталось меньше строки с запасом */
    const ensure = (need: number) => {
      if (y - need > margin) return;
      page = doc.addPage(A4);
      y = A4[1] - margin;
    };

    text('PINHEAD · ЛИСТ ЗАКУПКИ', 16);
    y -= 22;
    text(`Заказ №${order.bitrix_id || '—'} · ${order.title}`, 11);
    y -= 15;
    text(
      `Клиент: ${order.customer || '—'}   Менеджер: ${order.manager || '—'}`,
      9, dim,
    );
    y -= 13;
    text(
      `Запуск: ${fmtDate(order.launch_date)}   Срок: ${fmtDate(order.due_date)}`,
      9, dim,
    );
    y -= 24;

    for (const m of rows) {
      // Строка занимает до пяти печатных строк — считаем запас целиком,
      // иначе последняя позиция уезжает за нижний край молча
      ensure(70);
      const item = m.item_id ? itemById.get(m.item_id) : null;
      text(`${m.name}${m.article ? ` · ${m.article}` : ''}`, 11);
      y -= 14;
      text(
        `${MATERIAL_KIND[m.kind] ?? m.kind}`
        + `${m.role ? ` · ${MATERIAL_ROLE[m.role] ?? m.role}` : ''}`
        + `${m.color ? ` · цвет: ${m.color}` : ''}`,
        9, dim,
      );
      y -= 12;
      text(
        `Нужно: ${m.qty_expected ?? '—'}${m.unit ? ` ${m.unit}` : ''}`
        + `   Изделие: ${item ? `${item.product_type}${item.variant ? ` (${item.variant})` : ''}` : 'на весь заказ'}`,
        9,
      );
      y -= 12;
      if (m.manager_note) {
        text(`Комментарий: ${m.manager_note}`, 9, dim);
        y -= 12;
      }
      y -= 8;
    }

    pdfBytes = await doc.save();
  } catch (e) {
    console.error('[purchase-list-pdf]', e);
    return fail('PDF не сформирован', 500);
  }

  // --- Сохранение рядом с ТЗ --------------------------------------------------

  /**
   * Пишем СЕРВИСНЫМ ключом: файл и строку заводит система, а не человек, и
   * `uploaded_by` остаётся пустым намеренно — это не чья-то загрузка.
   * Путь фиксированный: повторное формирование ЗАМЕНЯЕТ файл, а не плодит
   * копии, — лист закупки один на заказ, и десять его версий в документах
   * означали бы вопрос «какая из них настоящая».
   */
  const admin = createClient(url, serviceKey);
  const path = `att/${orderId}/purchase/purchase-list.pdf`;
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true });
  if (upErr) return fail(`Файл не сохранён: ${upErr.message}`, 500);

  /**
   * Строка тоже одна: сначала убираем прежнюю запись этого же файла, потом
   * вставляем. Без этого каждое формирование добавляло бы строку на тот же
   * путь, и во вкладке «Файлы» копился бы список одинаковых листов.
   */
  await admin.from('erp_order_attachments')
    .delete()
    .eq('order_id', orderId)
    .eq('file_path', path);

  const { error: rowErr } = await admin.from('erp_order_attachments').insert({
    order_id: orderId,
    item_id: null,
    material_id: null,
    file_path: path,
    file_name: 'Лист закупки.pdf',
    kind: 'purchase',
  });
  if (rowErr) {
    // Файл без строки — сирота: он не виден в интерфейсе и занимает место
    await admin.storage.from(BUCKET).remove([path]);
    return fail(`Файл сохранён, но не привязан к заказу: ${rowErr.message}`, 500);
  }

  return json({ ok: true, file_path: path, rows: rows.length });
});
