import { useEffect, useState } from 'react';
import { EMPTY_REFS, loadCatalogRefs } from '../data/catalogRefs';

/**
 * Подсказки каталога (изделия, крой, ткани, отделка) для формы производственного
 * заказа и вкладки библиотеки.
 *
 * Загрузка идёт по ТРЕБОВАНИЮ, а не при старте оболочки: `main.jsx` тянет
 * каталоги только при включённом флаге Order Studio, и переносить их во входной
 * чанк ERP нельзя — бюджет критического пути. Спрашивают их лениво загружаемые
 * поверхности, и кэш `loadAllCatalogs` (30 минут, дедупликация параллельных
 * вызовов) делает повторные вызовы бесплатными.
 *
 * Модульный кэш поверх него нужен ради ПЕРВОГО кадра: без него каждое новое
 * открытие формы рисует пустой список подсказок, пока идёт даже мгновенный
 * ответ из sessionStorage.
 */
let cached = null;

export function useCatalogRefs() {
  const [refs, setRefs] = useState(cached ?? EMPTY_REFS);

  useEffect(() => {
    if (cached) return undefined;
    // Alive-гард: форму закрывают быстрее, чем отвечает сеть, и `setState`
    // на размонтированном компоненте — предупреждение React на ровном месте.
    let alive = true;
    loadCatalogRefs().then((loaded) => {
      cached = loaded;
      if (alive) setRefs(loaded);
    });
    return () => { alive = false; };
  }, []);

  return refs;
}

/** Сброс кэша подсказок — после правки каталогов в библиотеке. Тесты зовут его же. */
export function resetCatalogRefsCache() {
  cached = null;
}
