import { useMemo } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { daysLeft } from '../../utils/time';
import { dueLabelCompact } from '../../utils/format';
import {
  SUPPLY_STATE_BADGE,
  openSupplyStages,
  supplyMaterialSummary,
  supplyState,
} from '../../utils/supply';
import styles from '../../styles';

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
 * три одинаковых строки с одним и тем же списком материалов.
 *
 * ТОЛЬКО НАВИГАЦИЯ (правка заказчика 23.08, п. 1.1). Прежде каждая строка
 * несла россыпь действий — «Печать», «+ Материал», «Взять в работу»,
 * «Закупка завершена», — и было неочевидно, где закупщик работает постоянно.
 * Теперь здесь ключевые поля и «Открыть»; вся работа — в карточке закупки
 * (`PurchaseCard`), включая подтверждения. Второго места, где «Завершить
 * закупку» спрашивает своё, больше нет.
 */

/**
 * Прогресс материалов: «3 из 7» и небольшая шкала (п. 1.1).
 *
 * Ноль в знаменателе — это «неизвестно», а не «готово»: заказ, ждущий закупки,
 * у которого материалы ещё не заведены, обязан СКАЗАТЬ это, а не показать
 * пустую шкалу. Ровно на исчезновении таких заказов раздел и ломался.
 */
function MaterialsCell({ summary }) {
  if (summary.total === 0) {
    return (
      <span className={styles.cellWithIcon}>
        <Icon name="alert" size={13} />
        материалы не заведены
      </span>
    );
  }
  const percent = Math.round((summary.settled / summary.total) * 100);
  return (
    <>
      <span>{summary.settled} из {summary.total}</span>
      <span className={styles.progressTrack} aria-hidden="true">
        <span className={styles.progressFill} style={{ width: `${percent}%` }} />
      </span>
      {summary.missingPlan.length > 0 && (
        <div className={styles.subText} title={summary.missingPlan.map((m) => m.name).join(', ')}>
          без планового кол-ва: {summary.missingPlan.length}
        </div>
      )}
    </>
  );
}

function SupplyRow({ order, supplyDeptId, today, selected, onSelect }) {
  const stages = useMemo(
    () => openSupplyStages(order, supplyDeptId), [order, supplyDeptId]);
  const summary = useMemo(
    () => supplyMaterialSummary(order.materials, today), [order.materials, today]);
  const state = supplyState(stages);
  const left = daysLeft(order.due_date);

  return (
    <tr className={selected ? styles.rowSelected : undefined}>
      <td>№{order.bitrix_id || '—'}</td>
      <td>
        <span title={order.title}>{order.title}</span>
        {/* Ответственный менеджер: закупщику есть кому задать вопрос по листу */}
        {order.manager && (
          <div className={styles.subText}>менеджер: {order.manager}</div>
        )}
      </td>
      <td>{dueLabelCompact(left)}</td>
      <td className={styles.supplyMaterials}><MaterialsCell summary={summary} /></td>
      <td>
        <Badge variant={SUPPLY_STATE_BADGE[state].variant}>
          {SUPPLY_STATE_BADGE[state].label}
        </Badge>
      </td>
      <td>
        <Button
          variant={selected ? 'secondary' : 'ghost'}
          aria-pressed={selected}
          onClick={() => onSelect(order.id)}
        >
          {selected ? 'Открыт' : 'Открыть'}
        </Button>
      </td>
    </tr>
  );
}

/**
 * @param title  заголовок блока; `null` — не рисовать вовсе. Архив завершённых
 *   закупок монтирует этот же список внутрь своего `<details>`, и собственный
 *   заголовок оказывался ВТОРЫМ «Заказы в закупке» подряд (правка 24.08, п. 2:
 *   «не дублировать внутри архива заголовок»).
 * @param emptyText  текст пустого состояния: у активной очереди и у архива
 *   «пусто» значит разное.
 * @param label  имя области для клавиатуры и скринридера. Задаётся ОТДЕЛЬНО
 *   от заголовка: раскрытый архив держит на экране вторую такую же таблицу,
 *   и два одинаковых имени сделали бы их неразличимыми — и для человека,
 *   и для локатора спеки.
 */
export function SupplyQueue({
  orders, supplyDept, today, selectedId, onSelect,
  title = 'Заказы в закупке',
  label = 'Заказы в закупке',
  emptyText = 'Заказов, ожидающих закупки, нет — все этапы «Закупка» закрыты.',
}) {
  if (!supplyDept) return null;

  return (
    <section style={{ marginBottom: 20 }}>
      {title && (
        <div className={styles.toolbar}>
          <h2 className={styles.queueGroupTitle}>
            {title}
            {orders.length > 0 && <> · {orders.length}</>}
          </h2>
        </div>
      )}

      {orders.length === 0 ? (
        <div className={styles.emptyState}>{emptyText}</div>
      ) : (
        <ScrollHintBox className={styles.tableWrap} label={label}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>№ заказа</th>
                <th>Заказ</th>
                <th>Срок</th>
                <th>Материалы</th>
                <th>Статус</th>
                <th>Открыть</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <SupplyRow
                  key={o.id}
                  order={o}
                  supplyDeptId={supplyDept.id}
                  today={today}
                  selected={o.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
            </tbody>
          </table>
        </ScrollHintBox>
      )}
    </section>
  );
}
