/**
 * ТЕКСТЫ ЛИМИТА ФАЙЛА (правка 19.10, пп. 3–4).
 *
 * «Рядом с кнопкой загрузки указать „До 30 МБ на один файл“» и «если один
 * файл больше 30 МБ, показать его имя и причину отказа». Число мегабайт
 * НЕ вписывается в текст руками: его считают из лимита, который передал
 * вызывающий (`TZ_MAX_BYTES` / `ATTACH_MAX_BYTES` — зеркала бакета, сторож
 * `attachmentLimits.test.ts`). Подпись «до 15 МБ» рядом с лимитом 30 —
 * ровно та ошибка, которую закрывает этот модуль.
 */

/** Мегабайты для человека: лимиты бакета — целые МБ */
function megabytes(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

/** Подпись у кнопки выбора: лимит на ОДИН файл, а не на всю пачку */
export function fileLimitCaption(maxBytes: number): string {
  return `До ${megabytes(maxBytes)} МБ на один файл`;
}

/** Причина отказа файлу больше лимита — строкой рядом с его именем */
export function tooBigText(maxBytes: number): string {
  return `не загрузилось: файл больше ${megabytes(maxBytes)} МБ — уменьшите или разбейте PDF`;
}

/**
 * Сводка пачки для ОДНОГО `role="status"` блока: «Загружено 3 из 5 ·
 * не загрузилось 1». Чипы строк своей роли не несут — иначе читалка
 * объявляла бы каждую строку отдельно и перебивала сама себя.
 * Пусто, пока файлов нет: живой регион монтируется заранее и молчит.
 */
export function batchStatusText(uploaded: number, total: number, failed: number): string {
  if (total === 0) return '';
  const base = `Загружено ${uploaded} из ${total}`;
  return failed > 0 ? `${base} · не загрузилось ${failed}` : base;
}
