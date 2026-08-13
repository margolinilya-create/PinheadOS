import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from './useErpStore';

/**
 * Значения, которые УЖЕ встречаются в данных, — вторая половина подсказок
 * справочника (M-24 отчёта QA 13.08.2026).
 *
 * На проде справочник поставщиков пуст, а «Коттон Пром» стоит в закупке
 * с самого начала: подсказки не работали ни для кого, и каждый набирал имя
 * заново — с новой опечаткой. Разовый сид миграцией устарел бы на следующем
 * поставщике; наблюдаемые значения не устаревают никогда.
 *
 * Подмешиваются ТОЛЬКО виды, у которых значение реально живёт в данных.
 * Для `problem_type` или `experimental_task_type` такого поля нет — там
 * подсказки остаются чисто справочными, и это правильно: список причин
 * блокировки должен быть коротким и продуманным, а не «что кто-то однажды
 * написал».
 */

/** Откуда брать наблюдаемые значения для каждого вида справочника */
const SOURCES = {
  supplier: (orders) => orders.flatMap((o) => (o.materials ?? []).map((m) => m.supplier)),
  unit: (orders) => orders.flatMap((o) => (o.materials ?? []).map((m) => m.unit)),
  product_type: (orders) => orders.flatMap((o) => (o.items ?? []).map((it) => it.product_type)),
};

/**
 * Отключённое админом значение в подсказки не возвращается: иначе «отключить»
 * ничего не значило бы для полей, где значение уже встречалось.
 */
export function useDictionaryUsed(kind) {
  return useErpStore(
    useShallow((s) => {
      const pick = SOURCES[kind];
      if (!pick) return [];
      const disabled = new Set(
        s.dictionaries
          .filter((d) => d.kind === kind && !d.active)
          .map((d) => d.name.toLowerCase()),
      );
      const seen = new Map();
      for (const raw of pick(s.orders)) {
        const name = typeof raw === 'string' ? raw.trim() : '';
        if (!name) continue;
        const key = name.toLowerCase();
        if (disabled.has(key) || seen.has(key)) continue;
        seen.set(key, name);
      }
      return [...seen.values()].sort((a, b) => a.localeCompare(b, 'ru'));
    }),
  );
}
