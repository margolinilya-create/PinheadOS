// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * ЧТО ОБОЛОЧКА ТЯНЕТ В КРИТИЧЕСКИЙ ПУТЬ.
 *
 * `layout/*` грузится у ВСЕХ и ВСЕГДА: раздел «Производство» — единственный
 * вход в приложение. Поэтому любой статический импорт отсюда — это байты,
 * которые скачивает каждый, включая рабочего, открывшего очередь своего цеха
 * и больше ничего.
 *
 * ПОЧЕМУ СТОРОЖ ПОЯВИЛСЯ. Правка 20.09 поселила в оболочке окно чата, центр
 * уведомлений и всплывающие карточки — и все три приехали СТАТИКОЙ. За ними
 * уехала вся подсистема переписки (лента, сообщение, наборный, реакции,
 * поиск, подсказка упоминаний) и вместе с ней `screens.module.css`: чат
 * берёт стили через агрегатор `erp/styles`, а тот — оба модуля раздела.
 * Замер: +14,7 кБ JS и +7,2 кБ CSS gzip, бюджет критического пути пробит
 * на 8 % и 40 %.
 *
 * Отдельно про CSS: правило «оболочка не импортирует агрегатор» уже было
 * записано в `erp/styles.js` и сторожилось `stylesResolve.test.ts` — но тот
 * смотрит на `layout/*`, а `ChatWindow` лежит в `components/chat/`.
 * Правило соблюдалось буквой и нарушалось делом: агрегатор приехал
 * в оболочку транзитом, через компонент, который она монтирует.
 *
 * Тест текстовый и локальный: он читает исходники, а не собирает проект.
 * Бюджет (`npm run bundle:budget`) скажет «стало больше»; этот сторож
 * скажет ЧТО именно вернулось.
 */

const LAYOUT = resolve(__dirname);

/** Комментарии снимаем ДО поиска — правило проекта */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Только СТАТИЧЕСКИЕ импорты: `import … from '…'` в начале строки.
 * `import('…')` внутри `lazy()` — ровно то, чем эта подсистема и вынесена,
 * и запрещать его значило бы запрещать починку.
 */
function staticImports(file: string): string[] {
  const src = withoutComments(readFileSync(file, 'utf8'));
  return [...src.matchAll(/^import\s[\s\S]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
}

const files = readdirSync(LAYOUT)
  .filter((f) => /\.jsx?$/.test(f) && !f.includes('.test.'))
  .map((f) => join(LAYOUT, f));

describe('оболочка ERP: что едет всем и всегда', () => {
  it('файлы оболочки найдены', () => {
    // Сторож, который ничего не прочитал, зелен на чём угодно
    expect(files.length).toBeGreaterThan(2);
  });

  it('переписка не импортируется статикой', () => {
    for (const file of files) {
      for (const spec of staticImports(file)) {
        expect(
          spec.includes('components/chat/'),
          `${file}: чат должен монтироваться лениво, а не ехать всем входом`,
        ).toBe(false);
      }
    }
  });

  it('агрегатор стилей не импортируется — ни прямо, ни транзитом', () => {
    /**
     * Прямой импорт ловится здесь; транзитный — тем, что чат (единственный
     * его носитель в оболочке) запрещён предыдущей проверкой. Обе половины
     * нужны: без первой агрегатор въедет сам, без второй — через компонент.
     */
    for (const file of files) {
      for (const spec of staticImports(file)) {
        expect(
          /(^|\/)\.\.\/styles$/.test(spec) || spec === '../styles',
          `${file}: агрегатор тянет screens.module.css в критический путь`,
        ).toBe(false);
      }
    }
  });

  it('уведомления и всплывающие карточки вынесены из входа', () => {
    const shell = withoutComments(readFileSync(join(LAYOUT, 'ErpLayout.jsx'), 'utf8'));
    for (const mod of ['./NotificationCenter', './NoticePopups', '../components/chat/ChatWindow']) {
      expect(shell, `${mod} обязан грузиться по требованию`)
        .toContain(`import('${mod}')`);
    }
  });
  it('бизнес-задачи — только ленивыми экранами (правки 19.10, п. 7)', () => {
    /**
     * Маршрут и пункт меню едут в оболочке; экран, карточка, форма и список —
     * нет. Статический импорт `screens/bizTasks/…` из `ErpApp` или `layout/*`
     * унёс бы их в критический путь каждого (потолок оболочки — решение Р6).
     */
    const app = withoutComments(readFileSync(join(LAYOUT, '..', 'ErpApp.jsx'), 'utf8'));
    expect(app).toContain("lazyScreen(() => import('./screens/BizTasksScreen'))");
    // Один вход на оба адреса: второй `lazyScreen` — второй список предзагрузки в оболочке
    expect(app.match(/import\('\.\/screens\/BizTask/g)).toHaveLength(1);
    for (const file of [...files, join(LAYOUT, '..', 'ErpApp.jsx')]) {
      for (const spec of staticImports(file)) {
        expect(/BizTask|bizTasks\//.test(spec), `${file}: ${spec} — бизнес-задачи только лениво`).toBe(false);
      }
    }
  });
});
