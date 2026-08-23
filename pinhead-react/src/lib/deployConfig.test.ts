import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Раздача статики: `vercel.json` — тоже часть приложения.
 *
 * ЧТО БЫЛО ДО 23.08. `"framework": null` плюс ни одного правила кеширования
 * означало дефолт Vercel «для сайта без фреймворка»: ВСЁ — хешированные чанки,
 * шрифты, index.html — раздавалось с `max-age=0, must-revalidate`. Планшет
 * в цеху на каждом открытии условно перезапрашивал ~12 файлов кода и до
 * 10 шрифтов, уже лежащих у него в кеше. Хуже: `must-revalidate` запрещает
 * отдавать закешированное без проверки, то есть при обрыве Wi-Fi приложение
 * могло не открыться вовсе — при том что всё скачано. Ровно та зависимость
 * от сети цеха, ради устранения которой шрифты уводили с Google CDN.
 *
 * ПОЧЕМУ ПОРЯДОК ПРАВОК БЫЛ ОБЯЗАТЕЛЕН — и почему здесь два теста, а не один.
 * SPA-rewrite `"/(.*)" → /index.html` отдавал HTML на ЛЮБОЙ несуществующий
 * путь, включая `/assets/*.js` (проверено на живом проде: `HTTP/2 200`,
 * `content-type: text/html`). Повесить `immutable` на `/assets/` при таком
 * rewrite — значит однажды закрепить в браузере HTML под именем JS-файла
 * НАВСЕГДА: у человека приложение сломается до ручной очистки кеша.
 * Поэтому rewrite сначала сузили, и оба условия обязаны держаться вместе.
 *
 * `index.html` остаётся с коротким кешем сознательно: он и есть указатель
 * на текущие имена чанков, и цех, застрявший на старой версии, — цена
 * ошибки в другую сторону.
 *
 * ИЗВЕСТНОЕ СЛЕДСТВИЕ, названное вслух. Правило `/assets/` применяется
 * и к ответу 404, поэтому «файла нет» тоже кешируется на год (проверено
 * на превью: `404`, `immutable`). Опасно это ровно в одном сценарии —
 * откат деплоя вернул чанк по тому же адресу, а у человека уже лежит
 * закешированный отказ. Средствами `vercel.json` статус ответа не различить;
 * то же поведение у пресета Vercel для Next.js. Смягчает это `lib/appUpdate`
 * из того же захода: человек получает «вышло обновление» и после перезагрузки
 * берёт свежий `index.html` с другими именами чанков.
 */

const VERCEL_JSON = join(__dirname, '../../../vercel.json');

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}
interface VercelConfig {
  headers?: HeaderRule[];
  rewrites?: { source: string; destination: string }[];
}

function config(): VercelConfig {
  return JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as VercelConfig;
}

/** Значение Cache-Control у первого правила, чей source начинается с префикса */
function cacheControlFor(prefix: string): string | undefined {
  const rule = config().headers?.find((h) => h.source.startsWith(prefix));
  return rule?.headers.find((x) => x.key.toLowerCase() === 'cache-control')?.value;
}

describe('раздача статики на Vercel', () => {
  it('хешированные ассеты кешируются навсегда', () => {
    const value = cacheControlFor('/assets/');
    expect(value, 'у /assets/ нет правила Cache-Control').toBeDefined();
    expect(value).toContain('immutable');
    expect(value).toMatch(/max-age=31536000/);
  });

  /**
   * У шрифтов в имени НЕТ хеша содержимого, поэтому `immutable` им не даётся:
   * он запрещает даже ревалидацию, и заменённый файл не доехал бы до людей,
   * у которых он уже в кеше. Меняете шрифт — переименовывайте файл.
   */
  it('шрифты кешируются надолго, но без immutable', () => {
    const value = cacheControlFor('/fonts/');
    expect(value, 'у /fonts/ нет правила Cache-Control').toBeDefined();
    expect(value).toMatch(/max-age=31536000/);
    expect(value, 'у файлов без хеша в имени immutable запрещает замену').not.toContain('immutable');
  });

  it('index.html длинный кеш не получает', () => {
    const catchAll = config().headers?.find((h) => h.source === '/(.*)');
    const value = catchAll?.headers.find((x) => x.key.toLowerCase() === 'cache-control');
    expect(value, 'общее правило не должно задавать Cache-Control: '
      + 'оно накрыло бы и index.html, и цех застрял бы на старой версии')
      .toBeUndefined();
  });

  /**
   * Прогрев соединения с Supabase.
   *
   * `main.jsx` зовёт `init()` сразу, то есть первый запрос уходит к чужому
   * домену раньше, чем к нему открыто соединение: DNS + TCP + TLS на цеховом
   * Wi-Fi это сотни миллисекунд, полностью параллелимые с загрузкой кода.
   *
   * Проверяется ТОКЕН, а не готовый адрес: у превью и прода разные проекты
   * Supabase, и подставляет его Vite при сборке. `crossorigin` обязателен —
   * запросы идут с CORS, без него прогреется не то соединение.
   */
  it('index.html прогревает соединение с Supabase', () => {
    const html = readFileSync(join(__dirname, '../../index.html'), 'utf8');
    const link = /<link[^>]*rel="preconnect"[^>]*>/.exec(html)?.[0];
    expect(link, 'preconnect к Supabase пропал из index.html').toBeTruthy();
    expect(link).toContain('%VITE_SUPABASE_URL%');
    expect(link, 'без crossorigin прогреется не то соединение').toContain('crossorigin');
  });

  /**
   * СТОРОЖ ПАРНОГО УСЛОВИЯ. Пока rewrite ловит `/assets/`, отсутствующий чанк
   * отвечает 200 с HTML — и `immutable` выше превращается из оптимизации
   * в ловушку. Эти два правила нельзя разъединять.
   */
  it('SPA-rewrite не перехватывает статику — иначе immutable ловушка', () => {
    const rewrites = config().rewrites ?? [];
    expect(rewrites.length, 'SPA-rewrite пропал — прямые ссылки перестанут открываться')
      .toBeGreaterThan(0);
    for (const r of rewrites) {
      if (r.destination !== '/index.html') continue;
      expect(r.source, `rewrite "${r.source}" отдаёт index.html вместо 404 на `
        + 'отсутствующий /assets/*.js, а на /assets/ стоит immutable: '
        + 'браузер закеширует HTML под именем чанка навсегда')
        .toContain('assets/');
      expect(r.source).toContain('fonts/');
      expect(r.source, 'исключение должно быть отрицательным (?!…)').toContain('(?!');
    }
  });
});
