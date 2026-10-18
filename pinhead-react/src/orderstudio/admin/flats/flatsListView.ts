/**
 * Тексты и адреса списка флэтов (веха 5б, задача 6б) — отдельно от
 * `flatEditorView.ts`: их читает только вкладка (`FlatsTab`, `FlatsList`).
 * Общий модуль Rollup положил бы в чанк вкладки, и ленивый редактор тянул
 * бы статически весь чанк вкладки (замер «Редактор флэта», `bundle-budget`).
 */

export const EMPTY_LIST_TEXT = 'Флэтов пока нет — загрузите типовые или создайте свой из SVG';

/** Адрес флэта на вкладке (`?tab=flats&flat=<id>`) */
export const flatHref = (id: string): string => `?tab=flats&flat=${encodeURIComponent(id)}`;

/** DOM-id ссылки флэта в списке — сюда возвращается фокус по «← Все флэты» */
export const flatLinkId = (id: string): string => `flat-link-${id}`;
