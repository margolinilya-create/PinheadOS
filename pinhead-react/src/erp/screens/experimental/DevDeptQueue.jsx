import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Badge } from '../../components/Badge';
import { ButtonLink } from '../../components/Button';
import { EmptyResult } from '../../components/ErpStates';
import { OrderLink } from '../../components/OrderLink';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { useCompactLayout } from '../../layout/useCompactLayout';
import { experimentalDept, experimentalDeptEntries } from '../../utils/experimentalQueue';
import { dueLabelCompact } from '../../utils/format';
import { daysLeft } from '../../utils/time';
import styles from '../../styles';

/**
 * ОЧЕРЕДЬ УЧАСТКА «ЭКСПЕРИМЕНТАЛЬНЫЙ ЦЕХ» (правка заказчика 24.08, п. 4.1).
 *
 * «При создании заказа в выпадающий список участков добавить
 * "Экспериментальный цех"… Когда заказ доходит до этого шага, он появляется
 * в очереди экспериментального цеха. После выхода из экспериментального цеха
 * заказ продолжает движение по маршруту, который был задан при создании».
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ ПОВЕРХНОСТЬ. Участок непроизводственный (`is_production =
 * false`), а все общие поверхности — сайдбар, канбан, вкладки очереди, план,
 * загрузка — фильтруют цеха именно этим признаком. Без своего экрана этап
 * не был бы виден НИГДЕ, и заказ встал бы молча: ровно так 12.08 встали
 * 33 заказа с этапом закупки. Сторожит `routeReachable.test.ts`.
 *
 * ЧИТАЕТ ЭТАПЫ, А НЕ РАЗРАБОТКИ — и это главное отличие от прочих видов
 * раздела. Разработка (`erp_experimental`) и этап маршрута — разные вещи:
 * первая заводится на позицию-образец, второй ставится в маршрут ЛЮБОГО
 * заказа. Экран, показывающий соседние данные, выглядит рабочим и прячет
 * заказ целиком — тот самый дефект 12.08.
 *
 * БЕЗ ОТБОРА ПО `origin`, в отличие от очередей нанесений: документ ставит
 * участок в маршрут обычного заказа, и фильтр «только образцы» скрыл бы
 * ровно то, ради чего пункт и написан.
 */

const GROUP_VARIANT = {
  blocked: 'blocked',
  in_progress: 'progress',
  waiting: 'waiting',
  ready: 'info',
  awaiting_materials: 'waiting',
  done: 'ready',
  cancelled: 'skipped',
};

const GROUP_LABELS = {
  blocked: 'С проблемой',
  awaiting_materials: 'Ожидает материалы',
  waiting: 'Ожидает',
  ready: 'Готово к работе',
  in_progress: 'В работе',
  done: 'Завершено',
};

export function DevDeptQueue({ orders, departments }) {
  const location = useLocation();
  const isCompact = useCompactLayout();
  const dept = useMemo(() => experimentalDept(departments), [departments]);
  const entries = useMemo(
    () => experimentalDeptEntries(orders, departments), [orders, departments]);

  if (!dept) {
    return (
      <EmptyResult>
        Участок «Экспериментальный цех» не заведён в справочнике цехов —
        поставить его в маршрут не получится.
      </EmptyResult>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyResult>
        Открытых заданий на участке нет. Заказ появляется здесь, когда доходит
        до шага «Экспериментальный цех», поставленного в маршрут при создании.
      </EmptyResult>
    );
  }

  /*
    КОМПАКТНАЯ РАСКЛАДКА (правка 03.09). Шесть колонок, действие «Открыть» —
    последнее: на планшете кнопка, ради которой на экран и приходят, уезжала
    за правый край. Приём 22.08 доехал до очереди цеха, склада и закупки,
    но не до очереди участка ЭКС.
  */
  if (isCompact) {
    return (
      /* `role="list"` обязателен: `aria-label` на голом `<div>` не читается
         вовсе, и имя области терялось бы именно в компактной раскладке.
         Десктопная половина несёт имя через `ScrollHintBox`. */
      <div className={styles.dataCardList} role="list" aria-label="Очередь участка">
        {entries.map(({ order, item, stage, group, reason }) => (
          <div key={stage.id} className={styles.dataCard} role="listitem">
            <div className={styles.dataCardHead}>
              <OrderLink orderId={order.id} className={styles.dataCardTitle}>
                №{order.bitrix_id || '—'} · {order.title}
              </OrderLink>
              <Badge variant={GROUP_VARIANT[group]}>
                {GROUP_LABELS[group] ?? group}
              </Badge>
            </div>
            {reason && <div className={styles.cellSub}>{reason}</div>}
            <div className={styles.dataCardFields}>
              <span className={styles.dataCardField}>
                <span className={styles.dataCardFieldLabel}>Изделие</span>
                <span>
                  {item.product_type}
                  {stage.origin === 'experimental' && (
                    <span className={`${styles.chip} ${styles.chipNeutral}`}>ЭКС / ОБРАЗЕЦ</span>
                  )}
                </span>
              </span>
              <span className={styles.dataCardField}>
                <span className={styles.dataCardFieldLabel}>Тираж</span>
                <span>{stage.qty_done ?? 0} / {item.qty}</span>
              </span>
              <span className={styles.dataCardField}>
                <span className={styles.dataCardFieldLabel}>Срок</span>
                <span>{dueLabelCompact(daysLeft(order.due_date))}</span>
              </span>
            </div>
            <ButtonLink
              to={`/task/${stage.id}`}
              state={{ from: `${location.pathname}${location.search}` }}
              variant="primary"
              block
            >
              Открыть задание
            </ButtonLink>
          </div>
        ))}
      </div>
    );
  }

  return (
    <ScrollHintBox className={styles.tableWrap} label="Очередь участка">
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Заказ</th>
            <th>Изделие</th>
            <th>Тираж</th>
            <th>Срок</th>
            <th>Состояние</th>
            <th>Задание</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(({ order, item, stage, group, reason }) => (
            <tr key={stage.id}>
              <td>
                <OrderLink orderId={order.id}>№{order.bitrix_id || '—'}</OrderLink>
                <div className={styles.cellSub}>{order.title}</div>
              </td>
              <td>
                {item.product_type}
                {/* Образец помечен и здесь — строка та же, что видит общий цех */}
                {stage.origin === 'experimental' && (
                  <span className={`${styles.chip} ${styles.chipNeutral}`}>ЭКС / ОБРАЗЕЦ</span>
                )}
              </td>
              <td>{stage.qty_done ?? 0} / {item.qty}</td>
              <td>{dueLabelCompact(daysLeft(order.due_date))}</td>
              <td>
                <Badge variant={GROUP_VARIANT[group]}>
                  {GROUP_LABELS[group] ?? group}
                </Badge>
                {reason && <div className={styles.cellSub}>{reason}</div>}
              </td>
              <td>
                {/* Ссылка несёт текущий адрес: возврат из задания обязан
                    привести в то же представление, откуда ушли */}
                <ButtonLink
                  to={`/task/${stage.id}`}
                  state={{ from: `${location.pathname}${location.search}` }}
                  variant="ghost"
                >
                  Открыть
                </ButtonLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollHintBox>
  );
}
