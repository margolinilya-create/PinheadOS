import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * КОНТЕКСТ СПИСКА — В АДРЕСЕ (правки 05.10, пп. 6 и 8).
 *
 * «При возврате сохранять поиск, фильтры и место в списке». Пока поиск,
 * вкладка и страница жили в `useState`, любой уход — в карточку заказа,
 * со склада в закупку и обратно — сбрасывал их: человек возвращался
 * на первую страницу «Всех» и искал заново. Адрес переживает и переход,
 * и «Назад», и пересылку ссылки.
 *
 * Приём тот же, что у списка заказов (`OrdersScreen.patchPage`): правка
 * идёт `replace`, а не `push` — набор каждой буквы поиска не должен
 * становиться записью истории.
 *
 * Значение, равное умолчанию, из адреса УБИРАЕТСЯ: иначе ссылка «по умолчанию»
 * и ссылка с явно выставленным умолчанием были бы разными адресами одного
 * экрана, а `?tab=all&page=1` — шумом в каждой пересланной ссылке.
 *
 * ЛЮБАЯ ПРАВКА ПОДБОРА ВОЗВРАЩАЕТ НА ПЕРВУЮ СТРАНИЦУ (`patch`), если только
 * сама правка не задаёт страницу. Человек, стоявший на третьей странице,
 * после ввода в поиск видел бы пустоту и решал, что ничего не найдено.
 *
 * @param defaults  умолчания ключей; ключ без умолчания читается пустой строкой.
 *   Передавайте константу модуля, а не литерал: от неё зависят колбэки.
 */
const NO_DEFAULTS = {};

export function useListParams(defaults = NO_DEFAULTS) {
  const [params, setParams] = useSearchParams();

  const get = useCallback(
    (key) => params.get(key) ?? (defaults[key] ?? ''),
    [params, defaults],
  );

  /** Номер страницы: всё нечисловое и меньше единицы читается первой */
  const page = useMemo(() => {
    const n = Number.parseInt(params.get('page') ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }, [params]);

  const write = useCallback((patch, resetPage) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, raw] of Object.entries(patch)) {
        const value = raw == null ? '' : String(raw);
        if (value === '' || value === String(defaults[key] ?? '')) next.delete(key);
        else next.set(key, value);
      }
      if (resetPage && !('page' in patch)) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams, defaults]);

  /** Правка подбора: поиск, вкладка, фильтр — со сбросом страницы */
  const patch = useCallback((p) => write(p, true), [write]);
  /** Правка без сброса страницы: открытая карточка, сама страница */
  const patchKeep = useCallback((p) => write(p, false), [write]);
  const setPage = useCallback((n) => write({ page: n > 1 ? n : '' }, false), [write]);

  return { params, get, page, patch, patchKeep, setPage };
}
