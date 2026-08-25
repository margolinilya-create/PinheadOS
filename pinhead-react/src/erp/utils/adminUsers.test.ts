import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Администрирование учётных записей — сторож серверной половины.
 *
 * Функция `admin-users` держит `service_role`: ключ, который обходит RLS
 * ЦЕЛИКОМ. Всё, что отделяет админа от любого вошедшего пользователя, —
 * несколько строк проверки в её начале, и они не покрыты ничем, кроме
 * этого теста: e2e ходит в мок, unit-тесты слайса мокают сам вызов,
 * а тайпчек Deno-файл не смотрит вовсе (он вне tsconfig фронтенда).
 *
 * Тест читает ИСХОДНИК функции — так же, как остальные сторожи проекта
 * читают миграции, а не базу.
 */

const SRC = readFileSync(
  join(process.cwd(), '../supabase/functions/admin-users/index.ts'),
  'utf8',
);

/** Комментарии снимаем: объяснение «почему» содержит те же слова, что и код */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('гейт функции admin-users', () => {
  it('исходник найден — иначе сторож проверяет пустоту', () => {
    expect(SRC.length).toBeGreaterThan(1000);
  });

  /**
   * Личность берётся из ТОКЕНА, а не из тела запроса. Иначе любой вошедший
   * пришлёт чужой `user_id` в поле «кто я» и получит права администратора.
   */
  it('вызывающий определяется по заголовку Authorization', () => {
    expect(CODE).toMatch(/createClient\(\s*url,\s*anonKey/);
    expect(CODE).toMatch(/Authorization:\s*authHeader/);
    expect(CODE).toMatch(/caller\.auth\.getUser\(\)/);
  });

  /**
   * Права спрашиваются у САМОЙ `is_admin()` — той, на которой стоят политики
   * таблицы `profiles`. Своя проверка роли («select role from profiles»)
   * разошлась бы с политикой в первую же её правку; в этом проекте на таком
   * расхождении уже ловились (`isPrivileged` против `is_admin()`).
   */
  it('право проверяется вызовом is_admin() от лица вызывающего', () => {
    expect(CODE).toMatch(/caller\.rpc\('is_admin'\)/);
    expect(CODE).toMatch(/isAdmin !== true/);
  });

  it('service_role берётся из окружения и не участвует в проверке прав', () => {
    expect(CODE).toMatch(/Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/);
    // Клиент с ключом создаётся ПОСЛЕ отказа неадминам
    const gate = CODE.indexOf('isAdmin !== true');
    const service = CODE.indexOf('serviceKey, {');
    expect(gate).toBeGreaterThan(0);
    expect(service).toBeGreaterThan(gate);
  });
});

describe('заведение учётной записи', () => {
  /**
   * Адрес подтверждается сразу. Без этого GoTrue ждёт перехода по письму,
   * а письма шлёт встроенный SMTP (порядка двух в час, у gmail спам) — ровно
   * то, из-за чего в проекте застряли две учётные записи и появились
   * приглашения. Админ задал пароль сам, подтверждать письмом нечего.
   */
  it('адрес подтверждается сразу — иначе человек ждёт письма', () => {
    expect(CODE).toMatch(/email_confirm:\s*true/);
  });

  /**
   * Роль, цех и одобрение проставляет ТРИГГЕР `handle_new_user` через
   * одноразовое приглашение. Второй реализации «кому какие права» в проекте
   * быть не должно: она разъедется с первой в первую же правку.
   */
  it('роль приезжает кодом приглашения, а не отдельной записью профиля', () => {
    expect(CODE).toMatch(/from\('erp_invites'\)\s*\.insert/);
    expect(CODE).toMatch(/invite_code:\s*invite\.code/);
    // Профиль после создания только ЧИТАЕТСЯ — для проверки, что триггер сработал
    expect(CODE).not.toMatch(/from\('profiles'\)\s*\.insert/);
    expect(CODE).toMatch(/from\('profiles'\)\s*\.select/);
  });

  it('несработавшее приглашение гасится, а не остаётся открытой дверью', () => {
    expect(CODE).toMatch(/revoked_at[\s\S]{0,120}eq\('code',\s*invite\.code\)/);
  });

  /** Роль проставилась не та — это человек с чужими правами, о чём никто не узнает */
  it('расхождение роли с заказанной считается ошибкой, а не мелочью', () => {
    expect(CODE).toMatch(/profile\.role !== /);
    expect(CODE).toMatch(/profile\.approved !== true/);
  });
});

describe('смена адреса входа', () => {
  /**
   * Адрес — это ЛОГИН. Он живёт в `auth.users` (по нему пускают) и в `profiles`
   * (его показывает список). Поправить одно значит получить «человек в списке
   * есть, войти не может» — и искать причину будут в паролях.
   */
  it('меняется и в auth.users, и в profiles', () => {
    const fn = CODE.slice(CODE.indexOf('async function setEmail'));
    expect(fn).toMatch(/updateUserById\(p\.user_id,\s*\{\s*email/);
    expect(fn).toMatch(/from\('profiles'\)\.update\(\{ email \}\)/);
  });
});

describe('удаление учётной записи', () => {
  it('себя удалить нельзя — админ без админа чинится только руками', () => {
    expect(CODE).toMatch(/p\.user_id === callerId/);
  });

  /**
   * `created_by` объявлен `on delete no action`: удаление всё равно упало бы,
   * но уже наполовину — после `auth.users`. Проверка ДО нужна не ради запрета,
   * а ради того, чтобы человек прочитал причину, а не «внутреннюю ошибку».
   */
  it('заказы держат удаление, и об этом сказано до попытки', () => {
    const fn = CODE.slice(CODE.indexOf('async function deleteUser'));
    expect(fn).toMatch(/from\('erp_orders'\)[\s\S]{0,200}eq\('created_by'/);
    expect(fn).toMatch(/from\('orders'\)[\s\S]{0,200}eq\('created_by'/);
    const guard = fn.indexOf('orders > 0');
    const remove = fn.indexOf('deleteUser(p.user_id)');
    expect(guard).toBeGreaterThan(0);
    expect(remove).toBeGreaterThan(guard);
  });

  /**
   * `profiles` не связан с `auth.users` внешним ключом ВООБЩЕ — проверено
   * на боевой схеме. Строку профиля убираем явно, иначе в списке остаётся
   * человек, которого больше нет, и «Отключить» на нём ничего не делает.
   */
  it('строка профиля убирается явно — каскада на неё нет', () => {
    const fn = CODE.slice(CODE.indexOf('async function deleteUser'));
    expect(fn).toMatch(/from\('profiles'\)\.delete\(\)/);
    // Сотрудник ссылается на профиль `no action` — он уходит ПЕРЕД ним
    const emp = fn.indexOf("from('erp_employees').delete()");
    const prof = fn.indexOf("from('profiles').delete()");
    expect(emp).toBeGreaterThan(0);
    expect(prof).toBeGreaterThan(emp);
  });

  /**
   * ДОСТУП СНИМАЕТСЯ ПЕРВЫМ — иначе неудавшееся удаление РАСШИРЯЕТ права.
   *
   * Раньше первой уходила строка `erp_employees`: она единственная снимает
   * цеховую роль, а вход закрывался последним. Любой сбой между ними
   * оставлял человека, который по-прежнему входит, но уже без строки
   * сотрудника — и `erp_role_of_caller()` выводит роль из профиля, делая его
   * МЕНЕДЖЕРОМ по всей фабрике (ограничение «только свой цех» на человека
   * без цеха не действует). Это записано в миграции 20260814090000 и здесь
   * не было учтено.
   *
   * Порядок «сначала доступ» безопасен: внешних ключей на `auth.users`
   * в схеме нет вовсе, поэтому это удаление ничем не держится.
   */
  it('вход закрывается раньше, чем снимается цеховая роль', () => {
    const fn = CODE.slice(CODE.indexOf('async function deleteUser'));
    const authDelete = fn.indexOf('auth.admin.deleteUser(p.user_id)');
    const emp = fn.indexOf("from('erp_employees').delete()");
    expect(authDelete).toBeGreaterThan(0);
    expect(
      emp,
      'строка сотрудника снимается ДО закрытия входа: сбой между ними оставляет '
      + 'человека с доступом и без цеховой роли, то есть менеджером всей фабрики',
    ).toBeGreaterThan(authDelete);
  });
});

/**
 * Класс в разметке — ещё не стиль.
 *
 * У CSS Modules промах тихий: `styles.нетТакого` это `undefined`, то есть
 * класс просто не попадает в разметку. В этом же проекте так прожил целый
 * экран доступа — с системным шрифтом и нативной серой кнопкой, и человек
 * читал это как поломку сайта.
 *
 * Сторож живёт в `.ts`, а не рядом с тестом карточки: в `.jsx` обращение
 * к `process.cwd()` ловит ESLint (`no-undef`), и правило проекта — держать
 * такие проверки там, где node-глобали разрешены.
 */
describe('стили карточки пользователя объявлены', () => {
  /*
   * ОБА модуля раздела: 23.08 CSS разделён на `erp.module.css` (нужен
   * и оболочке) и `screens.module.css` (только экранам, едет их чанком).
   * Экраны импортируют агрегатор `erp/styles.js`, поэтому для них это
   * по-прежнему один набор классов — а сторож, привязанный к одному имени
   * файла, сторожил бы файл, а не правило.
   */
  const CSS = readFileSync(join(process.cwd(), 'src/erp/erp.module.css'), 'utf8')
    + readFileSync(join(process.cwd(), 'src/erp/screens.module.css'), 'utf8');
  const JSX = readFileSync(
    join(process.cwd(), 'src/erp/screens/admin/UserModal.jsx'), 'utf8',
  );
  const used = [...new Set(
    [...JSX.matchAll(/styles\.([A-Za-z][\w]*)/g)].map((m) => m[1]),
  )];

  it('классы найдены — иначе сторож проверяет пустоту', () => {
    expect(used.length).toBeGreaterThan(5);
  });

  it.each(used)('.%s объявлен в CSS раздела', (cls) => {
    expect(CSS).toMatch(new RegExp(`\\.${cls}[\\s,{:]`));
  });
});

describe('ответы функции', () => {
  /**
   * Браузер зовёт функцию кросс-доменно: без CORS-заголовков предварительный
   * запрос не пройдёт, и в интерфейсе это выглядит как «ничего не происходит».
   */
  it('preflight отвечает заголовками CORS', () => {
    expect(CODE).toMatch(/req\.method === 'OPTIONS'/);
    expect(CODE).toMatch(/'Access-Control-Allow-Headers'[\s\S]{0,120}authorization/);
  });

  /**
   * Причина отказа едет в теле как `error`. Клиент (`store/adminUsers.ts`)
   * достаёт её оттуда: у `functions.invoke` в самой ошибке лежит только
   * «non-2xx status code», то есть плоский шум вместо объяснения.
   */
  it('причина отказа — поле error в теле ответа', () => {
    expect(CODE).toMatch(/json\(\{ error: message \}, status\)/);
  });
});
