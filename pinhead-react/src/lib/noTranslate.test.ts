// @vitest-environment node
/**
 * Переводчик браузера ломает React: оборачивает текстовые узлы в <font>,
 * и перерисовка падает «Failed to execute 'removeChild' on 'Node'» —
 * экран ERP показывал «Не удалось загрузить экран» (12.11, /orders).
 * Запрет перевода — в index.html, этот сторож держит его на месте.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

describe('index.html запрещает перевод страницы', () => {
  it('<html translate="no">', () => {
    expect(html).toMatch(/<html\b[^>]*\btranslate="no"/);
  });

  it('<meta name="google" content="notranslate">', () => {
    expect(html).toMatch(/<meta\s+name="google"\s+content="notranslate"/);
  });
});
