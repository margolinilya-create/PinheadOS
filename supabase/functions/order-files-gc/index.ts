/**
 * Отчёт о ничьих файлах заказа (`order-artworks`) и недописанных версиях флэтов
 * (`garment-flats`) — веха 8, задача 7, решение К8.
 *
 * ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ ВЕТКА `storage-gc`. Та убирает `erp-attachments`, её
 * носителей сторожит замороженный ERP, и её деплой заменил бы живую уборку ERP.
 * Здесь — свои носители (`orderFileHolders.mjs`, побайтная копия
 * `pinhead-react/scripts/lib/orderFileHolders.mjs`; сверяет сторож
 * `src/orderstudio/orderFilesGc.test.ts`).
 *
 * ВОРОТА — `is_admin()` ОТ ЛИЦА ВЫЗЫВАЮЩЕГО (как у `storage-gc`): ключ `anon`
 * лежит в бандле, «валидный JWT» есть у любого, кто открыл сайт. Пути кандидатов
 * в ответе — только администратору: имена файлов — транслит клиентских, часто бренд.
 *
 * РЕЖИМ ПО УМОЛЧАНИЮ — ОТЧЁТ. Удаление — только при ДВУХ условиях сразу:
 * `apply: true` в теле И секрет функции `ORDER_FILES_GC_DELETE` ровно `'1'`
 * (ставит владелец после месяца отчётов). `apply: true` без секрета — отчёт.
 * Ошибка любой выборки — ни одного кандидата и ничего не удалено.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { deleteAllowed, reportNumbers, runReport } from './orderFileHolders.mjs';

/** Ключей за один `remove` (API принимает до 1000; меньше — короче ответ на сбой) */
const REMOVE_BATCH = 100;

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

type Candidate = { path: string; size: number };
type BucketReport = { bucket: string; candidates: Candidate[] };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2),
    { status, headers: { 'Content-Type': 'application/json' } });

/** `remove` отвечает СПИСКОМ УДАЛЁННОГО: короткий ответ — неполная уборка */
async function removeCandidates(buckets: BucketReport[]) {
  const result: Record<string, { кандидатов: number; удалено: number }> = {};
  for (const b of buckets) {
    let removed = 0;
    for (let i = 0; i < b.candidates.length; i += REMOVE_BATCH) {
      const batch = b.candidates.slice(i, i + REMOVE_BATCH).map((c) => c.path);
      const { data, error } = await db.storage.from(b.bucket).remove(batch);
      if (error) throw new Error(`${b.bucket}: ${error.message} (удалено ${removed})`);
      removed += data?.length ?? 0;
    }
    result[b.bucket] = { кандидатов: b.candidates.length, удалено: removed };
  }
  return result;
}

Deno.serve(async (req) => {
  try {
    // Личность и права — у вызывающего, а не из тела запроса
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ ошибка: 'Нужен вход в систему' }, 401);

    const caller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData?.user?.id) {
      return json({ ошибка: 'Сессия недействительна, войдите заново' }, 401);
    }
    const { data: isAdmin, error: adminError } = await caller.rpc('is_admin');
    if (adminError) return json({ ошибка: 'Не удалось проверить права' }, 500);
    if (isAdmin !== true) return json({ ошибка: 'Доступ только у администратора' }, 403);

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const remove = deleteAllowed(body, Deno.env.get('ORDER_FILES_GC_DELETE'));

    const report = await runReport(db, Date.now());
    if (!report.ok) {
      return json({ ошибка: `Выборка не удалась — ничего не тронуто: ${report.error}` }, 500);
    }
    const buckets = report.buckets as BucketReport[];
    const numbers = reportNumbers(report);

    if (!remove) {
      return json({
        режим: 'отчёт — ничего не удалено',
        бакеты: numbers,
        пути: Object.fromEntries(buckets.map((b) => [b.bucket, b.candidates.map((c) => c.path)])),
      });
    }

    const removed = await removeCandidates(buckets);
    const complete = Object.values(removed).every((r) => r.удалено === r.кандидатов);
    return json({ режим: 'удаление', бакеты: numbers, удалено: removed, полностью: complete },
      complete ? 200 : 500);
  } catch (e) {
    return json({ ошибка: e instanceof Error ? e.message : String(e) }, 500);
  }
});
