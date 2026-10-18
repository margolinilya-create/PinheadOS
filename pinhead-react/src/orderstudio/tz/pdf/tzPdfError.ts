/**
 * Отказ сборки PDF ТЗ, понятный человеку (веха 6+7, задача 3): текст —
 * продолжение фразы «ТЗ не собрано: …». Отдельным модулем без импортов:
 * экран отличает его от сбоя библиотеки, не загружая движок (как
 * `MaketPdfError` у PDF макета).
 */
export class TzPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TzPdfError';
  }
}

/** Начало фразы отказа для тоста и чек-листа */
export const TZ_PDF_FAIL = 'ТЗ не собрано';
