/**
 * Уборка ничьих файлов в бакете `erp-attachments`.
 *
 * ПОЧЕМУ ФУНКЦИЯ, А НЕ SQL. Supabase запрещает удаление из `storage.objects`
 * триггером `protect_objects_delete`: «Direct deletion from storage tables is
 * not allowed. Use the Storage API instead». Запрет верный — строка там это
 * МЕТАДАННЫЕ, сам объект лежит в S3, и снос метаданных убрал бы файл
 * с раздачи, оставив блоб висеть уже без следа о том, что чистить.
 * Storage API требует `service_role`, а он есть только на сервере: платформа
 * кладёт его в окружение функции, и наружу он не выходит.
 *
 * ИНВАРИАНТ, КОТОРЫЙ НЕЛЬЗЯ ОБОЙТИ ПАРАМЕТРАМИ: удаляется только объект,
 * чей ключ не встречается НИ В ОДНОЙ строке-носителе. Никакой вход не может
 * заставить функцию тронуть файл, на который кто-то ссылается, — поэтому
 * у неё нет параметра «удали вот это».
 *
 * ВОЗРАСТНОЙ ГЕЙТ И ЗАЧЕМ ОН. В проекте файл уходит в бакет ПРИ ВЫБОРЕ,
 * а строка создаётся при сабмите: между этими моментами файл — законный
 * «сирота». Уборка без гейта стёрла бы то, что человек прикладывает прямо
 * сейчас, и выглядело бы это как потерянный файл, а не как уборка. Поэтому
 * умолчание — сутки. Ноль допустим, только когда молодые сироты проверены
 * поимённо; для такого случая есть `alsoPaths` — список, за который
 * поручился человек, и он всё равно проходит проверку на «ничей».
 *
 * СУХОЙ ПРОГОН ПО УМОЛЧАНИЮ. У необратимого действия умолчанием не бывает
 * «сделать»: без `apply: true` функция лишь печатает, что собиралась тронуть.
 *
 * ГЕЙТ — `is_admin()`, ВЫЗВАННАЯ ОТ ЛИЦА ВЫЗЫВАЮЩЕГО, тот же порядок, что
 * у `admin-users`. Одного `verify_jwt` тут МАЛО: ключ `anon` публичен, он
 * лежит в бандле фронтенда, то есть «валидный JWT» есть у любого, кто открыл
 * сайт. Без этой проверки удаление файлов в боевом ERP звал бы кто угодно.
 * Своя реализация проверки роли не годится: она разошлась бы с политиками
 * `profiles` в первую же их правку — в проекте на таком уже ловились
 * (`isPrivileged` против `is_admin()`).
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'erp-attachments';

/**
 * Таблицы и колонки, ДЕРЖАЩИЕ ключ объекта в этом бакете. Состав закрыт
 * проверкой схемы 13.09: колонок, чьё имя содержит `file`, `path` или `url`,
 * больше нет, и ни одна JSONB-колонка подстрок `att/`/`tz/` не содержит.
 * Появится третий носитель — впишите его сюда, иначе уборка сотрёт живой файл.
 */
const REFERENCES = [
  { table: 'erp_order_attachments', column: 'file_path' },
  { table: 'erp_tz_documents', column: 'file_path' },
] as const;

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

type Obj = { path: string; size: number; createdAt: string };

/** Постранично и рекурсивно: `list` отдаёт максимум 100, папка видна по `id === null` */
async function listAll(prefix = '', acc: Obj[] = []): Promise<Obj[]> {
  const PAGE = 100;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.storage.from(BUCKET)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const e of data) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) await listAll(path, acc);
      else acc.push({ path, size: e.metadata?.size ?? 0, createdAt: e.created_at });
    }
    if (data.length < PAGE) break;
  }
  return acc;
}

/** Все занятые ключи — постранично: строк больше, чем отдаёт один запрос */
async function referencedPaths(): Promise<Set<string>> {
  const taken = new Set<string>();
  for (const { table, column } of REFERENCES) {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from(table)
        .select(column).not(column, 'is', null).range(from, from + PAGE - 1);
      if (error) throw new Error(`${table}.${column}: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data) taken.add((row as Record<string, string>)[column]);
      if (data.length < PAGE) break;
    }
  }
  return taken;
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2),
      { status, headers: { 'Content-Type': 'application/json' } });

  try {
    /*
      Личность и права берём У ВЫЗЫВАЮЩЕГО, а не из тела запроса: тело пишет
      тот же, кто зовёт, и верить ему нельзя.
    */
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

    const input = req.method === 'POST'
      ? await req.json().catch(() => ({}))
      : {};
    const apply = input.apply === true;
    const minAgeHours = typeof input.minAgeHours === 'number' ? input.minAgeHours : 24;
    const alsoPaths: string[] = Array.isArray(input.alsoPaths) ? input.alsoPaths : [];
    const vouched = new Set(alsoPaths);

    const objects = await listAll();
    const taken = await referencedPaths();
    const cutoff = Date.now() - minAgeHours * 3600_000;

    const orphans = objects.filter((o) => !taken.has(o.path));
    // Молодой сирота удаляется, ТОЛЬКО если за него поручились поимённо
    const doomed = orphans.filter(
      (o) => Date.parse(o.createdAt) <= cutoff || vouched.has(o.path),
    );
    const held = orphans.length - doomed.length;
    const bytes = doomed.reduce((s, o) => s + o.size, 0);

    if (!apply) {
      return json({
        режим: 'сухой прогон — ничего не удалено',
        объектов: objects.length,
        занятых: taken.size,
        ничьих: orphans.length,
        'к удалению': doomed.length,
        'придержано возрастным гейтом': held,
        мегабайт: +(bytes / 1048576).toFixed(1),
        minAgeHours,
        пути: doomed.map((o) => o.path),
      });
    }

    /**
     * `remove` принимает до 1000 ключей, но отвечает СПИСКОМ УДАЛЁННОГО,
     * а не ошибкой на промах: короткий ответ — неполная уборка, и это надо
     * назвать, а не посчитать успехом.
     */
    let removed = 0;
    for (let i = 0; i < doomed.length; i += 100) {
      const batch = doomed.slice(i, i + 100).map((o) => o.path);
      const { data, error } = await db.storage.from(BUCKET).remove(batch);
      if (error) return json({ ошибка: error.message, удалено: removed }, 500);
      removed += data?.length ?? 0;
    }

    return json({
      режим: 'удаление',
      'к удалению было': doomed.length,
      удалено: removed,
      'придержано возрастным гейтом': held,
      мегабайт: +(bytes / 1048576).toFixed(1),
      полностью: removed === doomed.length,
    }, removed === doomed.length ? 200 : 500);
  } catch (e) {
    return json({ ошибка: e instanceof Error ? e.message : String(e) }, 500);
  }
});
