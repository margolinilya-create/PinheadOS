import { useDictionary } from '../store/useDictionary';

/**
 * Подсказки справочника для обычного текстового поля (правка 12).
 * Именно datalist, а не select: справочник — подсказка, а не ограничение,
 * менеджер должен иметь возможность вписать значение, которого ещё нет.
 */
export function DictionaryDatalist({ kind, id }) {
  const items = useDictionary(kind);
  if (items.length === 0) return null;
  return (
    <datalist id={id}>
      {items.map((d) => <option key={d.id} value={d.name} />)}
    </datalist>
  );
}
