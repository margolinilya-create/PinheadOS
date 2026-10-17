/**
 * Цвет из данных → в стиль или SVG только проверенным: `#RGB` или `#RRGGBB`,
 * иначе нейтральный `#ccc`. Палитры правит руководство продаж, а прямая запись
 * в таблицы справочников открыта (решение владельца вехи 4) — строка вида
 * `#fff" onload=…` не должна дойти ни до атрибута SVG, ни до стиля.
 */
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function sanitizeHex(hex: unknown): string {
  return typeof hex === 'string' && HEX.test(hex) ? hex : '#ccc';
}
