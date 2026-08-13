import { useMemo } from 'react';
import { useDictionary } from '../store/useDictionary';
import { useDictionaryUsed } from '../store/useDictionaryUsed';

/**
 * Подсказки справочника для обычного текстового поля (правка 12).
 * Именно datalist, а не select: справочник — подсказка, а не ограничение,
 * менеджер должен иметь возможность вписать значение, которого ещё нет.
 *
 * К справочнику добавляются ЗНАЧЕНИЯ, УЖЕ ВСТРЕЧАЮЩИЕСЯ В ДАННЫХ (M-24 отчёта
 * QA 13.08.2026). Справочник поставщиков на проде пуст, хотя «Коттон Пром»
 * фигурирует в закупке с самого начала: подсказки не работали ни для кого,
 * и каждый набирал имя поставщика заново — с новой опечаткой.
 *
 * Подмешивать, а не «предзаполнить справочник миграцией»: разовый сид устареет
 * на следующем поставщике, а курируемый список остаётся курируемым — админ
 * по-прежнему решает, что в нём лежит и что отключено. Отключённое значение
 * из подсказок не всплывает: `useDictionaryUsed` вычитает выключенные имена.
 */
export function DictionaryDatalist({ kind, id }) {
  const items = useDictionary(kind);
  const used = useDictionaryUsed(kind);

  const options = useMemo(() => {
    const seen = new Set(items.map((d) => d.name.toLowerCase()));
    const extra = used.filter((name) => !seen.has(name.toLowerCase()));
    return [
      ...items.map((d) => ({ key: d.id, value: d.name })),
      ...extra.map((name) => ({ key: `used:${name}`, value: name })),
    ];
  }, [items, used]);

  if (options.length === 0) return null;
  return (
    <datalist id={id}>
      {options.map((o) => <option key={o.key} value={o.value} />)}
    </datalist>
  );
}
