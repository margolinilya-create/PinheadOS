import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Сторож против расползания заглавных начертаний.
 *
 * Их было пять почти одинаковых — 12/600/0.8px, 12/600/1.2px, 11/600/1.2px,
 * 10/600/1px — с разницей, которую никто не выбирал: класс писался копированием
 * соседнего и правился на глаз. Теперь начертание объявлено ОДНИМ групповым
 * правилом, а каждый класс несёт только осознанную разницу.
 *
 * Тест сторожит не вид, а способ: вид проверяют visual-эталоны, а «кто-то снова
 * вписал полный набор объявлений в свой класс» не видно ничем — оно и работает,
 * и выглядит правильно, и через полгода вариантов опять пять.
 */

const CSS = readFileSync(join(process.cwd(), 'src/erp/erp.module.css'), 'utf8');

/**
 * Начало ОДИНОЧНОГО правила по селектору.
 *
 * Групповые вхождения пропускаются: у правила `.pageTitle,\n.modalTitle {`
 * вторая строка выглядит как самостоятельное `.modalTitle {`, и наивный поиск
 * находил источник вместо уточнения — тест на этом и споткнулся.
 */
function ruleStart(selector: string): number {
  let at = -1;
  for (;;) {
    at = CSS.indexOf(`\n${selector} {`, at + 1);
    if (at < 0) throw new Error(`нет одиночного правила ${selector}`);
    // Предыдущая непустая строка кончается запятой ⇒ это часть группы
    const prev = CSS.lastIndexOf('\n', at - 1);
    if (!CSS.slice(prev + 1, at).trimEnd().endsWith(',')) return at;
  }
}

function ruleBody(selector: string): string {
  const open = CSS.indexOf('{', ruleStart(selector));
  return CSS.slice(open + 1, CSS.indexOf('}', open));
}

/** Классы, которые берут начертание из общего правила и уточняют только своё */
const REFINEMENTS = ['.navGroup', '.stubPhase', '.table th', '.deptTab', '.pageTitle', '.modalTitle'];

describe('заглавные начертания объявлены в одном месте', () => {
  it('групповое правило подписей существует и перечисляет всех', () => {
    const group = CSS.slice(CSS.indexOf('.labelCaps,'), CSS.indexOf('.labelCaps,') + 400);
    for (const cls of ['.navGroup', '.fieldLabel', '.table th', '.deptTab', '.stubPhase']) {
      expect(group, `${cls} выпал из общего правила`).toContain(cls);
    }
    expect(group).toMatch(/text-transform:\s*uppercase/);
  });

  it('групповое правило заголовков существует', () => {
    const at = CSS.indexOf('.pageTitle,');
    expect(at, 'нет общего правила заголовков').toBeGreaterThan(-1);
    expect(CSS.slice(at, at + 250)).toMatch(/font-family:\s*var\(--font-display\)/);
  });

  /**
   * Специфичность у источника и уточнения одинаковая — спор решает порядок
   * в файле. Правило-источник обязано стоять ВЫШЕ, иначе уточнения молча
   * перестанут работать: ошибка не падает, просто вид другой.
   */
  it.each(REFINEMENTS)('%s объявлен НИЖЕ своего источника', (selector) => {
    const source = Math.max(CSS.indexOf('.labelCaps,'), CSS.indexOf('.pageTitle,'));
    expect(ruleStart(selector)).toBeGreaterThan(source);
  });

  it.each(REFINEMENTS)('%s не переобъявляет начертание целиком', (selector) => {
    const body = ruleBody(selector);
    // Разница по размеру и разрядке осознанна; повтор остального — копипаст
    expect(body, `${selector} снова задаёт text-transform`).not.toMatch(/text-transform:/);
    expect(body, `${selector} снова задаёт font-weight`).not.toMatch(/font-weight:/);
    expect(body, `${selector} снова задаёт font-family`).not.toMatch(/font-family:/);
  });

  it('.fieldLabel своих объявлений не имеет вовсе', () => {
    // Он совпадал с источником побайтно — отдельное правило было чистым дублем.
    // Класс экспортируется CSS Modules из группового селектора.
    expect(CSS).not.toMatch(/\n\.fieldLabel \{/);
    expect(CSS).toContain('.fieldLabel,');
  });
});
