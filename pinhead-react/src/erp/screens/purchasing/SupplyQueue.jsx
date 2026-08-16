import { useMemo, useState } from 'react';
import { Badge } from '../../components/Badge';
import { Button, ButtonLink } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { useStagePermissions } from '../../store/useStagePermissions';
import { OrderLink } from '../../components/OrderLink';
import { confirm, confirmWithInput } from '../../../store/useConfirmStore';
import { pluralize } from '../../../utils/i18n';
import { daysLeft } from '../../utils/time';
import { dueLabelCompact } from '../../utils/format';
import {
  openSupplyStages,
  supplyMaterialSummary,
  supplyState,
} from '../../utils/supply';
import styles from '../../erp.module.css';

/**
 * Очередь закупки — заказы, у которых этап «Закупка» ещё не закрыт.
 *
 * ЗАЧЕМ ЭТОТ БЛОК. Раздел «Закупка» был реестром строк `erp_materials`
 * и об этапах маршрута не знал вовсе. Заказ, у которого закупка стоит первым
 * этапом, а материалы ещё не заведены, не показывался НИГДЕ: в разделе
 * закупки — потому что показывать было нечего, в очереди и на канбане —
 * потому что участок непроизводственный (`is_production = false`) и вырезан
 * у всех потребителей. Закупка не могла начать работу, и весь маршрут за ней
 * стоял. На боевой базе так стояли 33 заказа.
 *
 * Строка списка — ЗАКАЗ, а не этап: этап `supply` заводится на каждую позицию,
 * а материалы принадлежат заказу целиком, поэтому заказ из трёх позиций дал бы
 * три одинаковых строки с одним и тем же списком материалов. Закрытие
 * закрывает все открытые этапы заказа разом — ровно так же, как это делает
 * автозакрытие при поступлении материалов.
 *
 * Таблица закупочных строк ниже НЕ дублирует этот блок: она отвечает
 * на другой вопрос — «в каком состоянии каждая позиция», в том числе
 * у заказов, где этапа закупки нет вовсе (подряд с материалом подрядчика).
 */

/** Подпись и вид состояния закупки по заказу */
const STATE = {
  blocked: { label: 'Заблокировано', variant: 'blocked' },
  taken: { label: 'В работе', variant: 'progress' },
  open: { label: 'Ожидает', variant: 'waiting' },
};

function MaterialsCell({ summary }) {
  if (summary.total === 0) {
    // Главный случай дефекта: заказ ждёт закупки, а заводить пока нечего.
    // Строка обязана это СКАЗАТЬ, а не исчезнуть
    return (
      <span className={styles.cellWithIcon}>
        <Icon name="alert" size={13} />
        материалы не заведены
      </span>
    );
  }
  const { settled, total, missingPlan } = summary;
  return (
    <>
      <span>{settled} из {total} на месте</span>
      {missingPlan.length > 0 && (
        <div className={styles.subText} title={missingPlan.map((m) => m.name).join(', ')}>
          без планового кол-ва: {missingPlan.length}
        </div>
      )}
    </>
  );
}

function SupplyRow({ order, supplyDeptId, perms, onTake, onClose, onAddMaterial }) {
  const [busy, setBusy] = useState(false);
  const stages = useMemo(
    () => openSupplyStages(order, supplyDeptId), [order, supplyDeptId]);
  const summary = useMemo(
    () => supplyMaterialSummary(order.materials), [order.materials]);
  const state = supplyState(stages);
  const left = daysLeft(order.due_date);

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const take = () => run(() => onTake(order.id));

  /**
   * Закрытие закупки. Материалы на месте — обычное подтверждение; всё
   * остальное (материалов нет, часть не пришла) требует объяснения:
   * этап закрывается досрочно, и через неделю «почему» должно отвечать
   * не расследование, а история этапа.
   */
  const close = () => run(async () => {
    if (summary.allSettled) {
      const ok = await confirm({
        title: 'Завершить закупку по заказу?',
        message: `Все материалы на месте (${summary.settled} из ${summary.total}). `
          + `${stages.length === 1 ? 'Этап закупки закроется' : `Закроются все ${stages.length} этапов закупки`}, `
          + 'и заказ пойдёт на следующий этап маршрута.',
        confirmLabel: 'Завершить',
      });
      if (ok) await onClose(order.id, 'Материалы получены — закупка завершена');
      return;
    }
    const { ok, value } = await confirmWithInput({
      title: 'Завершить закупку досрочно?',
      message: summary.total === 0
        ? 'По заказу не заведено ни одного материала. Закупка закроется, и заказ пойдёт дальше по маршруту.'
        : `На месте ${summary.settled} из ${summary.total}. Закупка закроется, и заказ пойдёт дальше по маршруту.`,
      confirmLabel: 'Завершить',
      variant: 'danger',
      prompt: {
        label: 'Почему закупка завершена',
        placeholder: summary.total === 0
          ? 'Материалы давальческие / закупка не требуется'
          : 'Остаток придёт позже, производство не ждёт',
        required: true,
      },
    });
    if (ok) await onClose(order.id, value);
  });

  return (
    <tr>
      <td>
        <OrderLink
          orderId={order.id}
          title={`Открыть заказ №${order.bitrix_id || '—'}`}
        >
          №{order.bitrix_id || '—'}
        </OrderLink>
        <div className={styles.cellSub} title={order.title}>{order.title}</div>
      </td>
      <td>{dueLabelCompact(left)}</td>
      <td>
        {stages.length} {pluralize(stages.length, 'позиция', 'позиции', 'позиций')}
      </td>
      <td><MaterialsCell summary={summary} /></td>
      <td>
        <Badge variant={STATE[state].variant}>{STATE[state].label}</Badge>
        {state === 'blocked' && (
          <div className={styles.subText}>
            {stages.find((st) => st.status === 'blocked')?.block_reason || 'Заблокирован цехом'}
          </div>
        )}
      </td>
      <td>
        {/* Тот же класс, что у действий в очереди цеха: копия «две кнопки
            во flex» здесь была бы четвёртым вариантом одного и того же */}
        <div className={styles.queueActions}>
          {/* Лист закупки, сформированный менеджером при создании заказа:
              закупщик читает исходное задание, а не собирает его заново */}
          <ButtonLink to={`/orders/${order.id}/purchase-list`} variant="ghost">
            Лист закупки
          </ButtonLink>
          <Button variant="ghost" disabled={busy} onClick={() => onAddMaterial(order.id)}>
            + Материал
          </Button>
          {perms.take && state === 'open' && (
            <Button variant="secondary" disabled={busy} onClick={take}>
              Взять в работу
            </Button>
          )}
          {perms.complete && (
            <Button variant="primary" disabled={busy} onClick={close}>
              Закупка завершена
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function SupplyQueue({ orders, supplyDept, onTake, onClose, onAddMaterial }) {
  // Права спрашиваются ПО ДЕЙСТВИЮ и по цеху закупки — так же, как в очереди
  // цеха. Без прав блок остаётся на чтение: видеть свою очередь важно и тому,
  // кто в ней не работает (менеджер заказа)
  const perms = useStagePermissions(supplyDept?.id ?? null);

  if (!supplyDept) return null;

  return (
    <section style={{ marginBottom: 20 }}>
      <div className={styles.toolbar}>
        <h2 className={styles.queueGroupTitle}>
          В работе у закупки
          {orders.length > 0 && <> · {orders.length}</>}
        </h2>
      </div>

      {orders.length === 0 ? (
        <div className={styles.emptyState}>
          Заказов, ожидающих закупки, нет — все этапы «Закупка» закрыты.
        </div>
      ) : (
        <ScrollHintBox className={styles.tableWrap} label="Заказы в закупке">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>№ заказа</th>
                <th>Срок</th>
                <th>Этапов</th>
                <th>Материалы</th>
                <th>Статус</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <SupplyRow
                  key={o.id}
                  order={o}
                  supplyDeptId={supplyDept.id}
                  perms={perms}
                  onTake={onTake}
                  onClose={onClose}
                  onAddMaterial={onAddMaterial}
                />
              ))}
            </tbody>
          </table>
        </ScrollHintBox>
      )}
    </section>
  );
}
