import { useOrderDrawer } from '../../store/useOrderDrawer';
import { OrderDrawer } from './OrderDrawer';

/**
 * Хост боковой карточки заказа: монтируется один раз в ErpApp, слушает useOrderDrawer и
 * показывает Drawer поверх любого экрана. `key={orderId}` — свежий стейт вкладок на каждый заказ.
 */
export function OrderDrawerHost() {
  const orderId = useOrderDrawer((s) => s.orderId);
  const close = useOrderDrawer((s) => s.close);
  if (!orderId) return null;
  return <OrderDrawer key={orderId} orderId={orderId} onClose={close} />;
}
