import { describe, expect, it } from 'vitest';
import {
  ORDER_FOLDERS, canMoveBetweenFolders, filesInFolder, folderOf, kindForFolder, moveTargetOf,
} from './orderFolders';
import { latestMatching, withoutComments } from './migrations.testutil';
import type { ErpAttachmentKind } from '../types';

/**
 * ДВЕ ПАПКИ ФАЙЛОВ ЗАКАЗА (правка заказчика 14.09, п. 3).
 *
 * Главное, что здесь сторожится, — ДВА правила, и оба легко сломать молча:
 *
 * 1. Файл не должен ПРОПАСТЬ. Вид, заведённый позже и забытый в раскладке,
 *    обязан остаться видимым: пропавший файл человек не найдёт вовсе, а файл
 *    не в той папке он хотя бы видит.
 * 2. Между папками ходят ТОЛЬКО свободные файлы. У макета нанесения есть
 *    адресат (`print_id`), и смена вида оторвала бы его от нанесения — цех
 *    перестал бы видеть макет в задании. Ровно это же правило стоит
 *    на сервере, и расхождение дало бы «кнопка есть, действие падает».
 */

const att = (kind: string) => ({ kind: kind as ErpAttachmentKind });

const ALL_KINDS: ErpAttachmentKind[] = [
  'preview', 'attachment', 'packaging', 'tech', 'purchase', 'purchase_list',
  'subcontract', 'stage_result', 'dev_task', 'dev_pattern', 'dev_passport',
  'dev_photo', 'print', 'label', 'note', 'production',
];

describe('раскладка по папкам', () => {
  it('рабочие файлы и макеты — в «Файлы производства»', () => {
    for (const kind of ['production', 'print', 'label', 'stage_result']) {
      expect(folderOf(att(kind)), kind).toBe('production');
    }
  });

  it('общие файлы сделки — в «Файлы сделки»', () => {
    for (const kind of ['attachment', 'preview', 'note', 'purchase_list', 'packaging', 'tech']) {
      expect(folderOf(att(kind)), kind).toBe('deal');
    }
  });

  it('ни один вид не пропадает: незнакомый остаётся видимым', () => {
    // fail-open. Пропажа файла хуже, чем файл не в той папке: в первом случае
    // человек его не найдёт вовсе и решит, что файла не было
    for (const kind of [...ALL_KINDS, 'какой-то новый вид']) {
      const folder = folderOf(att(kind));
      expect(ORDER_FOLDERS.map((f) => f.key), kind).toContain(folder);
    }
  });

  it('каждый файл попадает РОВНО в одну папку', () => {
    const files = ALL_KINDS.map((kind, i) => ({ id: String(i), kind })) as never[];
    const counts = ORDER_FOLDERS.map((f) => filesInFolder(files, f.key).length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(ALL_KINDS.length);
  });
});

describe('перемещение между папками', () => {
  it('ходят только свободные файлы', () => {
    expect(canMoveBetweenFolders(att('attachment'))).toBe(true);
    expect(canMoveBetweenFolders(att('production'))).toBe(true);
  });

  it('файл с адресатом не перекладывается', () => {
    // print/label привязаны к нанесению и бирке, stage_result — к этапу,
    // purchase_list — к своему блоку карточки. Смена вида порвала бы связь
    for (const kind of ['print', 'label', 'stage_result', 'purchase_list', 'dev_photo']) {
      expect(canMoveBetweenFolders(att(kind)), kind).toBe(false);
      expect(moveTargetOf(att(kind)), kind).toBeNull();
    }
  });

  it('цель перемещения — вторая папка', () => {
    expect(moveTargetOf(att('attachment'))).toBe('production');
    expect(moveTargetOf(att('production'))).toBe('deal');
  });

  it('в папку кладётся её свободный вид', () => {
    expect(kindForFolder('production')).toBe('production');
    expect(kindForFolder('deal')).toBe('attachment');
  });
});

/**
 * КЛИЕНТ И СТРАЖ ГОВОРЯТ ОДНО И ТО ЖЕ.
 *
 * Страж строже интерфейса — «кнопка есть, действие падает», и виноватым
 * выглядит человек; мягче — дыра (правка `kind` открывала бы правку любой
 * колонки, включая `order_id` и `file_path`, то есть подмену файла в чужом
 * заказе). Поэтому набор перекладываемых видов и право сверяются с текстом
 * действующей миграции.
 */
describe('серверный страж вложений', () => {
  const sql = withoutComments(latestMatching(
    /create or replace function public\.erp_attachment_guard\(/,
    'erp_attachment_guard()',
  ));

  it('разрешает перекладывать ровно свободные виды', () => {
    expect(sql).toMatch(/array\['attachment', 'production'\]/);
    for (const kind of ['print', 'label', 'stage_result']) {
      expect(sql, `${kind} не должен ходить между папками`)
        .not.toMatch(new RegExp(`array\\[[^\\]]*'${kind}'[^\\]]*\\][^;]*new\\.kind`));
    }
  });

  it('требует то же право, что клиентский гейт', () => {
    expect(sql).toContain("erp_has_permission('files.manage')");
  });

  it('пропускает service_role: пустой auth.uid() не запирает починку через SQL', () => {
    expect(sql).toMatch(/if \(select auth\.uid\(\)\) is null then\s*\n\s*return new;/);
  });

  it('прочие колонки вложения неизменны — замена файла это новая строка', () => {
    for (const column of ['order_id', 'file_path', 'item_id', 'stage_id', 'print_id']) {
      expect(sql, `${column} не сторожится`).toContain(`new.${column} is distinct from old.${column}`);
    }
  });
});
