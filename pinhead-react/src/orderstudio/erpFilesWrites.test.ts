// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { relative, sep } from 'node:path';
import { SRC_DIR, sourceFiles, readSource } from '../testutil/sourceFiles';

/**
 * Сторож записи в публичный бакет `erp-attachments` вне ERP (веха 6+7, К12,
 * проверка безопасности пп. 3, 5).
 *
 * Из Order (и любого кода вне `src/erp`) в бакет пишет ОДИН модуль —
 * `orderstudio/api/erpFiles.ts`: только `upload` с `upsert: false`, ключ
 * попытки без id заказа, тип только из `ERP_FILE_TYPES` и никогда из
 * `blob.type`. Импортирует писателя только шаг запуска `bridge/launchFiles.ts`.
 * ERP пишет свой бакет сам — он заморожен и сюда не входит.
 */
const WRITER = 'orderstudio/api/erpFiles.ts';
const IMPORTERS = ['orderstudio/bridge/launchFiles.ts'];

const norm = (p: string) => relative(SRC_DIR, p).split(sep).join('/');
const outsideErp = sourceFiles().filter((p) => !norm(p).startsWith('erp/'));
const files = outsideErp.map((p) => ({ name: norm(p), text: readSource(p) }));

/** Комментарии прочь: упоминание бакета в комментарии — не обращение к нему */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const MENTION = /(['"`])erp-attachments\1|\bERP_ATTACHMENTS_BUCKET\b/;
const WRITE_NAMES = /\.(upload|update|remove|move|copy|uploadToSignedUrl|createSignedUploadUrl|upsert)\s*\(/g;
const IMPORT_ERP_FILES = /(?:from\s+|import\s*\(\s*)['"`][^'"`]*\/erpFiles(?:\.ts)?['"`]/;

/** Проверки писателя — функцией, чтобы самопроверка могла подать мутанта */
function writerProblems(text: string): string[] {
  const code = stripComments(text);
  const out: string[] = [];
  const writes = [...code.matchAll(WRITE_NAMES)].map((m) => m[1]);
  if (writes.length !== 1 || writes[0] !== 'upload') out.push(`записи: ${writes.join(', ') || 'нет'}`);
  if (/upsert:\s*true/.test(code)) out.push('upsert: true');
  if (!/\.upload\([^;]*?\{\s*upsert: false, contentType \}\)/.test(code)) out.push('upload без { upsert: false, contentType }');
  if (/contentType:\s*[A-Za-z_$][\w$]*\.type\b/.test(code) || /\.type\s*as\s*ErpFileType/.test(code)) out.push('тип из Blob');
  if (!/ERP_FILE_TYPES as readonly string\[\]\)\.includes\(contentType\)/.test(code)) out.push('нет проверки белого списка');
  if (!/new Blob\(\[body\], \{ type: contentType \}\)/.test(code)) out.push('тело не перекладывается в Blob назначенного типа');
  return out;
}

describe('erp-attachments вне ERP — только api/erpFiles.ts', () => {
  it('бакет называют только писатель (вне src/erp)', () => {
    expect(files.filter((f) => f.name !== WRITER && MENTION.test(stripComments(f.text))).map((f) => f.name)).toEqual([]);
  });

  it('писатель: одна загрузка без upsert, тип из белого списка и не из Blob', () => {
    const w = files.find((f) => f.name === WRITER);
    expect(w).toBeDefined();
    expect(writerProblems(w!.text)).toEqual([]);
  });

  it('писателя импортирует только шаг запуска bridge/launchFiles.ts', () => {
    const importers = files.filter((f) => f.name !== WRITER && IMPORT_ERP_FILES.test(stripComments(f.text))).map((f) => f.name);
    expect(importers.filter((n) => !IMPORTERS.includes(n))).toEqual([]);
  });

  it('нигде вне ERP тип загрузки не берётся из blob.type', () => {
    const bad = files.filter((f) => /contentType:\s*(?:blob|body|file|data)\.type\b/.test(stripComments(f.text)));
    expect(bad.map((f) => f.name)).toEqual([]);
  });

  it('самопроверка: мутанты писателя ловятся', () => {
    const w = files.find((f) => f.name === WRITER)!.text;
    expect(writerProblems(w.replace('upsert: false, contentType }', 'upsert: true, contentType }')).length).toBeGreaterThan(0);
    expect(writerProblems(`${w}\nsupabase.storage.from(ERP_ATTACHMENTS_BUCKET).remove([x]);`).length).toBeGreaterThan(0);
    expect(writerProblems(w.replace('{ upsert: false, contentType }', '{ upsert: false, contentType: body.type }')).length).toBeGreaterThan(0);
    expect(writerProblems(w.replace('new Blob([body], { type: contentType })', 'body')).length).toBeGreaterThan(0);
    expect(writerProblems(w.replace('(ERP_FILE_TYPES as readonly string[]).includes(contentType)', 'true')).length).toBeGreaterThan(0);
  });

  it('самопроверка: импорт писателя из экрана ловится', () => {
    expect(IMPORT_ERP_FILES.test("import { uploadErpFile } from '../api/erpFiles';")).toBe(true);
    expect(IMPORT_ERP_FILES.test("const m = await import('../api/erpFiles');")).toBe(true);
    expect(IMPORT_ERP_FILES.test("import { x } from '../api/erpFilesOther';")).toBe(false);
    expect(MENTION.test("supabase.storage.from('erp-attachments')")).toBe(true);
  });
});
