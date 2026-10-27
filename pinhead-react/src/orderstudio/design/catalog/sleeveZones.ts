/**
 * Зоны рукавов парами (веха 5б → 5в, Э2): левый ↔ правый. Лёгкий модуль без
 * зависимостей — его читают и зеркальный рукав админки (`edit/mirrorSleeve`),
 * и копия нанесения на другой рукав (`ui/panel/copyOps`).
 */
export const SWAP_ZONE: Readonly<Record<string, string>> = { 'sleeve-l': 'sleeve-r', 'sleeve-r': 'sleeve-l' };
