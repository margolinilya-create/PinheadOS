/**
 * «Оформить как заказ v4» на шаге «Итог» визарда главной: заказ визарда
 * становится новым заказом v4 (сохраняется сразу — у карточки должен быть
 * адрес). Модуль грузится по клику (`import()`), чтобы чанк «Итога» не тянул
 * стор и API v4.
 *
 * Расчёт цены ставится ДО создания: первое сохранение уходит раньше, чем
 * карточка смонтируется и поставит свой, — без него в списке был бы заказ
 * с позициями и пустой суммой. Карточка потом заменяет расчёт тем же.
 */
import { useStore } from '../../store/useStore';
import { useSalesStore } from '../store/useSalesStore';
import { makeOrderPricer } from '../screens/useOrderPrice';
import { wizardOrderToSalesOrder } from './wizardOrderToSales';
import type { WizardCatalogs, WizardItem } from './wizardAdapter';
import type { PriceCatalogs } from '../pricing/priceOrder';

export interface TransferResult {
  id: string;
  number: string;
  /** Общий комментарий визарда — перенести вручную */
  notes: string;
}

export async function transferWizardToSales(managerName = ''): Promise<TransferResult | null> {
  const s = useStore.getState() as unknown as WizardItem;
  const { order, notes } = wizardOrderToSalesOrder(s, s as unknown as WizardCatalogs, managerName);
  const sales = useSalesStore.getState();
  sales.setPricer(makeOrderPricer(s as unknown as PriceCatalogs & { prices?: unknown }));
  const id = await sales.createNew(order);
  if (!id) return null;
  return { id, number: useSalesStore.getState().current?.number ?? '', notes };
}
