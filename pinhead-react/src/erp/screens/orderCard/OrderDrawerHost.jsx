import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useOrderDrawer } from '../../store/useOrderDrawer';
import { OrderDrawer } from './OrderDrawer';

/**
 * Хост боковой карточки заказа: монтируется один раз в ErpApp, слушает useOrderDrawer и
 * показывает Drawer поверх любого экрана. `key={orderId}` — свежий стейт вкладок на каждый заказ.
 *
 * Хост живёт ВНЕ `<Routes>`, поэтому переживал смену маршрута: кнопка «Назад»
 * (главный жест на планшетах цехов) уводила на предыдущий экран, а панель
 * оставалась висеть поверх уже другого содержимого. Любая смена адреса её закрывает.
 *
 * Диплинк на карточку намеренно не заводим через `?order=`: полноценная страница
 * `/orders/:id` и есть диплинк, и Ctrl/Cmd-клик по любой ссылке заказа ведёт именно
 * на неё (см. orderLinkClick).
 */
export function OrderDrawerHost() {
  const orderId = useOrderDrawer((s) => s.orderId);
  const close = useOrderDrawer((s) => s.close);
  const { pathname } = useLocation();

  useEffect(() => {
    // Закрываем при смене маршрута; на первом рендере закрывать нечего
    useOrderDrawer.getState().close();
  }, [pathname]);

  if (!orderId) return null;
  return <OrderDrawer key={orderId} orderId={orderId} onClose={close} />;
}
