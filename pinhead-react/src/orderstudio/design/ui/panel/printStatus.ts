/**
 * Статус нанесения по проверке макета (веха 5в, Э2): «Готово / Проверить /
 * Исправить» у строки слоя. Проверка ничего не блокирует (правило 5а), поэтому
 * не «ошибка», а «исправить». Общее серьёзное замечание без нанесения (силуэт
 * другой модели) — «Исправить» у всех: иначе строки показали бы «Готово» при
 * запрете отправки. Подсказки (`info`) — «Готово».
 */
import type { PreflightIssue } from '../../export/preflight';

export type PrintStatus = 'ok' | 'check' | 'fix';

export const PRINT_STATUS_TEXT: Record<PrintStatus, { sign: string; text: string }> = {
  ok: { sign: '✓', text: 'Готово' },
  check: { sign: '!', text: 'Проверить' },
  fix: { sign: '✕', text: 'Исправить' },
};

export function printStatus(issues: readonly PreflightIssue[], key: string): PrintStatus {
  const own = issues.filter((i) => i.printKey === key || (!i.printKey && i.level === 'serious'));
  if (own.some((i) => i.level === 'serious')) return 'fix';
  if (own.some((i) => i.level === 'warn')) return 'check';
  return 'ok';
}
