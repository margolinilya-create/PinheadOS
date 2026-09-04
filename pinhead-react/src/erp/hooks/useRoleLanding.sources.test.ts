import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Точка вызова посадочной. Правило и его связка с адресом покрыты
 * `useRoleLanding.test.jsx`; здесь — что хук вообще смонтирован: правило,
 * которое никто не зовёт, существует и не работает.
 *
 * ФАЙЛ `.ts`, А НЕ `.jsx`, как у `DevAnnotations.sources.test.ts`: в `.jsx`
 * конфиг ESLint даёт `no-undef` на `process`, а путь к исходнику иначе
 * не собрать — `import.meta.url` в Vitest не файловая схема.
 */
describe('посадочная по роли: точка вызова', () => {
  it('оболочка раздела зовёт хук', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/erp/ErpApp.jsx'), 'utf8');
    expect(src).toMatch(/useRoleLanding\(canOpen\)/);
  });
});
