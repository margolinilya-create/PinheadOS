import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useStore } from '../../../store/useStore';
import { loadAllCatalogs } from '../../../lib/catalogs';
import { TableSkeleton } from '../../components/ErpSkeletons';
import { LoadFailed } from '../../components/ErpStates';

const SkuEditor = React.lazy(() => import('../../../components/editors/SkuEditor'));

/**
 * Библиотека — редактор каталогов (изделия, ткани, отделка, обработки,
 * фурнитура, ценообразование, правила категорий, зоны нанесения) внутри
 * админки ERP.
 *
 * ПОЧЕМУ ОБЁРТКА, А НЕ ПРОСТО `lazy(SkuEditor)`. Редактор правит то, что лежит
 * в сторе Order Studio, а стор при старте ERP каталоги НЕ грузит: `main.jsx`
 * зовёт `loadCatalogs()` только при включённом флаге Order Studio. Слайс
 * каталогов инициализирован дефолтами из `src/data`, и «Сохранить» в редакторе,
 * открытом на незагруженном сторе, записал бы эти дефолты поверх боевых
 * каталогов в `app_config` — молча и целиком.
 *
 * Раньше это было неважно: редактор существовал только там, где каталоги уже
 * загружены. Открывая его новой аудитории — админам ERP, у которых флага нет, —
 * загрузку обязан обеспечить тот, кто открывает.
 *
 * Поэтому: сначала каталоги, потом редактор. И **сбой загрузки показывается
 * ошибкой с повтором, а не пропускается**: `loadCatalogs` в слайсе при неудаче
 * молча откатывается на локальный кэш и дефолты — для визарда это разумно
 * (заказ всё равно можно оформить), для редактора это ровно тот случай, когда
 * правка уедет поверх боевых данных.
 */
export default function LibraryTab() {
  const [state, setState] = useState('loading');
  // Счётчик попыток — способ перезапустить эффект по «Повторить», не вызывая
  // setState прямо в эффекте (правило react-hooks/set-state-in-effect)
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Alive-гард: вкладку переключают быстрее, чем отвечает сеть
    let alive = true;
    // Оба вызова идут в один кэш `loadAllCatalogs` (30 минут, дедупликация),
    // поэтому второй запрос в сеть не уходит.
    loadAllCatalogs()
      .then(async (raw) => {
        if (!Array.isArray(raw?.skuCatalog)) throw new Error('каталог изделий не приехал');
        await useStore.getState().loadCatalogs();
        if (alive) setState('ready');
      })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [attempt]);

  const retry = useCallback(() => {
    setState('loading');
    setAttempt((a) => a + 1);
  }, []);

  if (state === 'error') return <LoadFailed what="каталоги" onRetry={retry} />;
  if (state === 'loading') return <TableSkeleton rows={6} label="Загрузка библиотеки" />;

  return (
    <Suspense fallback={<TableSkeleton rows={6} label="Загрузка библиотеки" />}>
      <SkuEditor />
    </Suspense>
  );
}
