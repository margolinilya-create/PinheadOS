#!/usr/bin/env node
/**
 * authz-rls-probe.mjs — воспроизводимые проверки авторизации/RLS для PINHEAD Order Studio.
 *
 * Что делает (в терминах BUGREPORT.md):
 *   A. Baseline    — аноним (без сессии) НЕ читает erp_orders (RLS требует authenticated).
 *   B. CR-1 config — публичные настройки GoTrue: открыта ли регистрация, нужен ли confirm.
 *   C. HI-2 / CR-1 — пользователь БЕЗ профиля/approve читает ВСЕ заказы (нужны creds).
 *   D. HI-1 / HI-3 — не-админ создаёт/меняет заказ и «отгружает» его в обход ship-gate
 *                    (ТОЛЬКО на собственной тест-записи; гейт CONFIRM_WRITES=1).
 *   E. ME-2        — комментарий с подделанным author.
 *   F. NEG         — что ДОЛЖНО быть закрыто: delete, самоэскалация роли, запись цен.
 *
 * БЕЗОПАСНОСТЬ:
 *   - Пишущие проверки (D/E) выполняются ТОЛЬКО при CONFIRM_WRITES=1 и создают
 *     собственный заказ с префиксом "[QA-SEC-TEST]"; скрипт удаляет его в конце
 *     (для полного удаления заказа нужен admin — см. cleanup-заметку ниже).
 *   - Никогда не запускать деструктивно по боевой базе. Предпочтительно — Supabase
 *     preview-ветка или отдельный тест-аккаунт.
 *
 * ЗАПУСК:
 *   SB_URL=https://<ref>.supabase.co SB_ANON=<anon-key> \
 *     [TEST_EMAIL=... TEST_PASS=...] [CONFIRM_WRITES=1] node authz-rls-probe.mjs
 *
 *   TEST_EMAIL/TEST_PASS — уже ПОДТВЕРЖДённый (email confirmed) тест-пользователь.
 *   Само-подтверждение почты скрипт не делает (это не уязвимость, а шаг злоумышленника);
 *   для end-to-end на preview подтвердите почту в Dashboard или SQL:
 *     update auth.users set email_confirmed_at = now() where email = '<TEST_EMAIL>';
 */

const SB_URL = process.env.SB_URL;
const SB_ANON = process.env.SB_ANON;
const { TEST_EMAIL, TEST_PASS, CONFIRM_WRITES } = process.env;

if (!SB_URL || !SB_ANON) {
  console.error('Нужны переменные окружения SB_URL и SB_ANON (anon-ключ).');
  process.exit(2);
}

const rest = (p) => `${SB_URL}/rest/v1/${p}`;
const auth = (p) => `${SB_URL}/auth/v1/${p}`;
const H = (jwt) => ({
  apikey: SB_ANON,
  Authorization: `Bearer ${jwt || SB_ANON}`,
  'Content-Type': 'application/json',
});
const line = (t) => console.log(`\n=== ${t} ===`);
const ok = (c) => (c ? '✅' : '❌');

async function jget(url, opts) {
  const r = await fetch(url, opts);
  let body = null;
  try { body = await r.json(); } catch { /* non-json */ }
  return { status: r.status, body };
}

async function main() {
  // ── A. Baseline: аноним не видит заказы ────────────────────────────────
  line('A. Baseline — anon читает erp_orders (ожидаем 0 строк = RLS блокирует)');
  const anon = await jget(rest('erp_orders?select=id&limit=5'), { headers: H() });
  const anonRows = Array.isArray(anon.body) ? anon.body.length : 'n/a';
  console.log(`   HTTP ${anon.status}, строк: ${anonRows} ${ok(anonRows === 0)} (0 = защищено)`);

  // ── B. CR-1 config: открыта ли регистрация ────────────────────────────
  line('B. CR-1 — публичные настройки GoTrue');
  const s = await jget(auth('settings'), { headers: { apikey: SB_ANON } });
  console.log(`   disable_signup:      ${s.body?.disable_signup}  ${ok(s.body?.disable_signup === true)} (true = закрыто)`);
  console.log(`   mailer_autoconfirm:  ${s.body?.mailer_autoconfirm}  (false = требует confirm)`);
  console.log(`   external.email:      ${s.body?.external?.email}`);
  if (s.body?.disable_signup === false) {
    console.log('   ⚠ Регистрация ОТКРЫТА — любой может создать authenticated-сессию (подтвердив почту).');
  }

  if (!TEST_EMAIL || !TEST_PASS) {
    console.log('\n(Пропускаю C–F: не заданы TEST_EMAIL/TEST_PASS подтверждённого тест-пользователя.)');
    return;
  }

  // ── login ──────────────────────────────────────────────────────────────
  line('login тест-пользователя');
  const lg = await jget(auth('token?grant_type=password'), {
    method: 'POST', headers: { apikey: SB_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS }),
  });
  const jwt = lg.body?.access_token;
  if (!jwt) { console.error('   не удалось залогиниться:', lg.status, lg.body); process.exit(1); }
  const sub = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub;
  console.log(`   HTTP ${lg.status}, sub=${sub}`);

  // ── C. HI-2 / CR-1: пользователь без профиля читает всё ────────────────
  line('C. HI-2 / CR-1 — есть ли профиль и сколько заказов видно');
  const prof = await jget(rest('profiles?select=id,role,approved'), { headers: H(jwt) });
  console.log(`   свой профиль: ${JSON.stringify(prof.body)} ${ok(Array.isArray(prof.body) && prof.body.length === 0)} (пусто = нет профиля/approve)`);
  const orders = await jget(rest('erp_orders?select=id,title,manager,status'), { headers: H(jwt) });
  const n = Array.isArray(orders.body) ? orders.body.length : 0;
  console.log(`   видит erp_orders: ${n} строк ${ok(n > 0)} (>0 при отсутствии профиля = УТЕЧКА всех заказов)`);

  if (CONFIRM_WRITES !== '1') {
    console.log('\n(Пропускаю D–F: пишущие проверки. Запустите с CONFIRM_WRITES=1 на preview/тест-среде.)');
    return;
  }

  // ── D. HI-1 / HI-3: создать/изменить/«отгрузить» собственный тест-заказ ─
  line('D. HI-1 — не-админ создаёт заказ (RPC erp_create_order)');
  const created = await jget(rest('rpc/erp_create_order'), {
    method: 'POST', headers: H(jwt),
    body: JSON.stringify({ payload: { order: { title: '[QA-SEC-TEST] delete-me', status: 'active' }, items: [], materials: [] } }),
  });
  const oid = typeof created.body === 'string' ? created.body : created.body;
  console.log(`   HTTP ${created.status}, order id: ${oid} ${ok(created.status === 200 && oid)}`);

  console.log('   HI-1 — не-админ PATCH-ит заказ (произвольный patch, без владения):');
  const upd = await jget(rest(`erp_orders?id=eq.${oid}`), {
    method: 'PATCH', headers: { ...H(jwt), Prefer: 'return=representation' },
    body: JSON.stringify({ title: '[QA-SEC-TEST] EDITED-by-nonadmin', priority: 999 }),
  });
  console.log(`   HTTP ${upd.status} → priority=${upd.body?.[0]?.priority} ${ok(upd.body?.[0]?.priority === 999)}`);

  console.log('   HI-3 — не-админ ставит done_early+shipped в обход isOrderReadyToShip:');
  const ship = await jget(rest(`erp_orders?id=eq.${oid}`), {
    method: 'PATCH', headers: { ...H(jwt), Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'done_early', shipped_status: 'shipped' }),
  });
  console.log(`   HTTP ${ship.status} → ${ship.body?.[0]?.status}/${ship.body?.[0]?.shipped_status} ${ok(ship.body?.[0]?.shipped_status === 'shipped')}`);

  // ── E. ME-2: подделка автора комментария ───────────────────────────────
  line('E. ME-2 — комментарий с подделанным автором');
  const cmt = await jget(rest('erp_order_comments'), {
    method: 'POST', headers: { ...H(jwt), Prefer: 'return=representation' },
    body: JSON.stringify({ order_id: oid, author: 'Директор (СПУФ)', text: 'QA-SEC spoof' }),
  });
  console.log(`   HTTP ${cmt.status} → author=${cmt.body?.[0]?.author} ${ok(cmt.body?.[0]?.author === 'Директор (СПУФ)')}`);

  // ── F. NEG: что должно быть ЗАКРЫТО ────────────────────────────────────
  line('F. NEG — проверки, которые ДОЛЖНЫ проваливаться (защита)');
  const del = await jget(rest(`erp_orders?id=eq.${oid}`), {
    method: 'DELETE', headers: { ...H(jwt), Prefer: 'return=representation' },
  });
  const delN = Array.isArray(del.body) ? del.body.length : 'n/a';
  console.log(`   delete заказа: удалено ${delN} ${ok(delN === 0)} (0 = admin-only, защищено)`);

  const esc = await jget(rest('profiles'), {
    method: 'POST', headers: { ...H(jwt), Prefer: 'return=representation' },
    body: JSON.stringify({ id: sub, name: 'pwn', email: TEST_EMAIL, role: 'admin', approved: true }),
  });
  console.log(`   self-escalation profiles: HTTP ${esc.status} ${ok(esc.status === 403)} (403 = заблокировано)`);

  const price = await jget(rest('app_config'), {
    method: 'POST', headers: { ...H(jwt), Prefer: 'return=representation' },
    body: JSON.stringify({ key: 'prices', value: { pwned: 1 } }),
  });
  console.log(`   write app_config.prices: HTTP ${price.status} ${ok(price.status === 403)} (403 = admin/director-only)`);

  console.log('\n⚠ CLEANUP: тест-заказ помечен "[QA-SEC-TEST]". Он остался в статусе done_early и НЕ удалён');
  console.log('   (delete = admin-only). Удалите его админом/SQL:');
  console.log(`   delete from erp_orders where id = '${oid}';`);
}

main().catch((e) => { console.error(e); process.exit(1); });
