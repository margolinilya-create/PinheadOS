import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { withoutJsComments } from './utils/migrations.testutil';

/**
 * ПОДПИСЬ ПОЛЯ СВЯЗАНА С САМИМ ПОЛЕМ — ИНАЧЕ ЭТО ПРОСТО ТЕКСТ РЯДОМ.
 *
 * В разделе 154 рукописных `<label>` против 35 вызовов примитива `Field`, и
 * обход 12.09 начинался с намерения мигрировать их все. Проверка показала,
 * что мигрировать не нужно: 121 из них — обёртка
 * `<label className={styles.field}><span>Подпись</span><input/></label>`,
 * а это ПОЛНОЦЕННАЯ связь (implicit label): клик по подписи фокусирует поле,
 * скринридер читает имя. Массовая замена на примитив дала бы единообразие
 * импортов ценой правки полутора сотен мест — и ни одного исправленного
 * дефекта. Правило проекта «примитив, который не приняли, — не примитив»
 * тут не нарушено: `Field` принят там, где нужны `aria-invalid`
 * и `aria-describedby` (ошибка и подсказка), а обёртка — законный второй
 * способ, и оба дают связь.
 *
 * Сторожить надо не СПОСОБ, а РЕЗУЛЬТАТ: подпись, не связанная ни с чем, —
 * вот настоящий дефект. Он тихий: выглядит как обычная форма, ломается
 * только у того, кто работает клавиатурой или с экранного диктора, — то есть
 * его никто не заметит, пока не придёт аудит доступности.
 */

const SRC = join(process.cwd(), 'src', 'erp');

function jsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) jsxFiles(p, out);
    else if (/\.jsx$/.test(name) && !/\.test\.jsx$/.test(name)) out.push(p);
  }
  return out;
}

/** Контролы, которые считаются «полем внутри подписи» */
const CONTROL = /<(input|select|textarea|DateField|Field|DictionaryDatalist|SearchInput)\b/;

describe('каждая подпись поля связана с контролом', () => {
  const labels: { file: string; line: number }[] = [];
  const unbound: string[] = [];

  for (const file of jsxFiles(SRC)) {
    const src = withoutJsComments(readFileSync(file, 'utf8'));
    const rel = file.replace(process.cwd() + '/', '');
    let from = 0;
    for (;;) {
      const open = src.indexOf('<label', from);
      if (open === -1) break;
      const close = src.indexOf('</label>', open);
      // Незакрытая `<label` — либо самозакрывающийся тег (не бывает),
      // либо разбор сбился; считаем такой случай находкой, а не пропускаем
      const body = close === -1 ? src.slice(open, open + 400) : src.slice(open, close);
      const line = src.slice(0, open).split('\n').length;
      labels.push({ file: rel, line });

      const bound = /htmlFor=/.test(body) || CONTROL.test(body);
      if (!bound) unbound.push(`${rel}:${line} — подпись не связана: нет ни htmlFor, ни контрола внутри`);
      from = close === -1 ? open + 6 : close + 8;
    }
  }

  it('подписи в разделе есть — иначе сторож проверяет пустоту', () => {
    expect(labels.length).toBeGreaterThan(50);
  });

  it('ни одной подписи без связи с полем', () => {
    expect(unbound, unbound.join('\n')).toEqual([]);
  });
});
