import KpPanel from './KpPanel';
import PaymentPanel from '../../payment/PaymentPanel';
import TzGroupsPanel from './TzGroupsPanel';
import SendPanel from './SendPanel';

/**
 * Нижняя часть «ТЗ и цена» (веха 6+7, задача 5) — ленивый чанк вкладки:
 * «Оплата» (`PaymentPanel`, общий с «К запуску»), «ТЗ» (группы, предпросмотр,
 * черновик всех ТЗ) и «Отправить в работу» (`SendPanel` — единственная точка
 * отправки). Отдельным чанком, чтобы цепочка отправки и экраны ТЗ не ложились
 * в граф «Рабочего места» (бюджет `bundle-budget-m67`).
 *
 * @param {{
 *   order: import('../../model/types').SalesOrder, user: object,
 *   catalogs: import('../model/tzDocTypes').TzCatalogs | null, catalogsFailed?: boolean,
 *   checklist: import('../model/sendChecklist').CheckItem[] | null,
 *   today: string, appOrigin: string, loadEngine: () => Promise<object | null>,
 *   focusSend?: boolean, onSendFocused?: () => void,
 * }} props
 */
export default function TzSummary({
  order, price, user, catalogs, catalogsFailed, checklist, today, appOrigin, loadEngine, focusSend, onSendFocused,
}) {
  return (
    <>
      <PaymentPanel order={order} user={user} />
      <KpPanel order={order} price={price} catalogs={catalogs} today={today} />
      <TzGroupsPanel order={order} catalogs={catalogs} today={today} appOrigin={appOrigin} loadEngine={loadEngine} />
      <SendPanel
        order={order}
        user={user}
        checklist={checklist}
        catalogs={catalogs}
        catalogsFailed={catalogsFailed}
        today={today}
        focusHeading={focusSend}
        onFocused={onSendFocused}
      />
    </>
  );
}
