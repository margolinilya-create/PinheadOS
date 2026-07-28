import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Сохраняет и восстанавливает позицию прокрутки экрана (правка 6):
 * из очереди цеха уходят в карточку заказа и возвращаются обратно — список
 * должен открыться там же, где его оставили, а не в начале.
 *
 * Ключ — путь вместе с параметрами, поэтому смена цеха или фильтров получает
 * свою позицию. Восстанавливаем только когда данные уже отрисованы (`ready`),
 * иначе прокручивать ещё нечего.
 */
export function useScrollRestore(ready = true) {
  const { pathname, search } = useLocation();
  const key = `erp_scroll:${pathname}${search}`;

  useEffect(() => {
    if (!ready) return undefined;
    const saved = Number(sessionStorage.getItem(key));
    if (saved > 0) {
      // Ждём кадр отрисовки: до него высота документа ещё нулевая и скролл не сработает
      requestAnimationFrame(() => window.scrollTo(0, saved));
    }
    const save = () => sessionStorage.setItem(key, String(window.scrollY));
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      save();
      window.removeEventListener('scroll', save);
    };
  }, [key, ready]);
}
