/**
 * Заказ визарда главной → новый заказ Order v4 («Оформить как заказ v4»
 * на шаге «Итог»). Позиции переводит `wizardToSalesItem` — тот же перевод,
 * что у визарда в карточке v4; шапка — по таблице ниже.
 *
 * Общего комментария (`notes`) в шапке v4 нет: он возвращается отдельно,
 * экран просит перенести его вручную — молча он не теряется.
 */
import { wizardToSalesItem } from './wizardAdapter';
import type { WizardCatalogs, WizardItem } from './wizardAdapter';
import type { SalesOrder } from '../model/types';

/** Упаковка визарда (`packType`) → упаковка заказа v4 */
const PACK_NOTE: Record<string, string> = {
  bopp: 'БОПП пакет',
  zip: 'ЗИП пакет',
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export interface WizardOrderTransfer {
  order: Partial<SalesOrder>;
  /** Общий комментарий визарда — у шапки v4 для него нет поля */
  notes: string;
}

export function wizardOrderToSalesOrder(
  state: WizardItem, cat: WizardCatalogs, managerName = '',
): WizardOrderTransfer {
  const snaps: WizardItem[] = Array.isArray(state.items) ? state.items : [];
  const items = snaps.filter((s) => s?.sku).map((s) => wizardToSalesItem(s, cat));

  const customer = str(state.name);
  const contact = [state.contact, state.phone, state.email, state.messenger]
    .map(str).filter(Boolean).join(', ');
  const packType = str(state.packType) || (state.packOption ? 'bopp' : 'none');
  const packNote = PACK_NOTE[packType];
  const firstModel = items[0]?.product_type ?? '';

  return {
    order: {
      customer,
      contact,
      title: [customer, firstModel].filter(Boolean).join(' · '),
      manager: str(managerName),
      bitrix_id: str(state.bitrixDeal),
      due_date: str(state.deadline),
      delivery_address: str(state.address),
      urgent: !!state.urgentOption,
      packaging: packNote ? 'individual' : 'none',
      packaging_note: packNote ?? '',
      items,
    },
    notes: str(state.notes),
  };
}
