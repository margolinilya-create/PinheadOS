import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { buildQueueEntries } from '../../utils/queueEntries';
import { WAREHOUSE_DEPT_CODE } from '../../utils/routes';
import { GARMENT_INTAKE_LABELS, garmentIntakeAction } from '../../utils/garmentSource';
import { OrderLink } from '../../components/OrderLink';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { useCompactLayout } from '../../layout/useCompactLayout';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { dueLabelCompact } from '../../utils/format';
import { GarmentIntakeModal } from './GarmentIntakeModal';
import styles from '../../styles';

/**
 * ПРИЁМКА ГОТОВОГО ИЗДЕЛИЯ — ОЧЕРЕДЬ ЭТАПОВ СКЛАДА (правки 07.09, п. 9).
 *
 * «Для типа производства „Готовое изделие“ с нанесением „на готовом“ добавить
 * обязательную приёмку на складе до нанесения… Сейчас заказ сразу попадает
 * в шелкографию».
 *
 * ЭКРАН ЧИТАЕТ ЭТАПЫ, А НЕ СКЛАДСКИЕ ЗАДАЧИ. Это записанное правило раздела
 * (`routeReachable.test.ts`, дефект 12.08 с 33 вставшими заказами): участок
 * непроизводственный, в общей очереди и на канбане его этапы не показываются
 * по построению, и экран, который смотрел бы на соседние данные, выглядел бы
 * рабочим, спрятав заказ целиком. Поэтому строки строит `buildQueueEntries` —
 * та же функция, что очередь цеха и канбан: группы и причина ожидания
 * считаются один раз и одинаково.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ БЛОК, А НЕ ВКЛАДКА В СПИСКЕ ЗАДАЧ. Остальной экран склада
 * перечисляет `erp_warehouse_tasks` — другую сущность с другими статусами
 * и другими действиями. Подмешать этапы в тот же список значило бы завести
 * строку, у которой половина колонок пуста, а кнопки чужие.
 */
export function FgIntakeQueue() {
  const { orders, departments, bypasses } = useErpStore(useShallow((s) => ({
    orders: s.orders,
    departments: s.departments,
    bypasses: s.bypasses,
  })));
  const access = useErpAccess();
  const compact = useCompactLayout();

  const deptId = useMemo(
    () => departments.find((d) => d.code === WAREHOUSE_DEPT_CODE)?.id ?? null,
    [departments],
  );

  /**
   * Только НЕЗАКРЫТЫЕ приёмки: закрытая — это история заказа, и её место
   * в карточке, а не в рабочей очереди склада. `done`/`skipped` отсеиваем
   * здесь, а не фильтром группы: `buildQueueEntries` сам пропускает `skipped`.
   */
  const rows = useMemo(() => {
    if (!deptId) return [];
    return buildQueueEntries(orders, departments, { departmentId: deptId, bypasses })
      .filter((e) => e.stage.status !== 'done');
  }, [orders, departments, deptId, bypasses]);

  /**
   * ПРИЁМКА ОТКРЫВАЕТ ОКНО, А НЕ ЗАКРЫВАЕТ ЭТАП (правка 16.09, п. 1).
   *
   * Прежде кнопка звала `confirmStageDone` и ставила этапу `done`: числа
   * приёмки не вводились вовсе, и журнал сообщал «склад отчитался 0 из N» —
   * ровно жалоба документа. Теперь количество приходит из заказа, кладовщик
   * правит фактическое, а этап закрывается СЛЕДСТВИЕМ числа: `qty_done`
   * добрал тираж — закрылся, недоприёмка — остался открытым.
   *
   * Гейт закрытия при этом не потерян и не скопирован: его держит
   * `erp_stage_completion_block` у самого писателя (`submitStageReport`),
   * то есть одна проверка на все пути закрытия этапа.
   */
  const [intake, setIntake] = useState(null);

  /**
   * ПРАВО ТО, ЧТО ПИШЕТ СЕРВЕР. Приёмка уходит отчётом, то есть пишет
   * `qty_done` (`stage.progress`) и может закрыть этап (`stage.complete`);
   * страж этапов пускает переход в `done` под любым из двух. Клиентский
   * гейт обязан разрешать РОВНО это: требовать только `stage.complete`
   * значило бы прятать кнопку у кладовщика, которому сервер отчёт примет.
   */
  const canAccept = (access.can('stage.progress') || access.can('stage.complete'))
    && access.canActIn(deptId);

  if (!deptId || rows.length === 0) return null;

  /**
   * ЭТАП ОДИН, ДЕЙСТВИЯ РАЗНЫЕ (правка 14.09, п. 1). На одном экране рядом
   * оказываются приёмка чужого товара (давальческое), выдача своего со склада
   * готовой продукции и передача нашего изделия в нанесение. Строки с
   * одинаковой подписью и разным смыслом читались бы как дубль, поэтому
   * действие называет себя в каждой строке; правило — `garmentIntakeAction`,
   * а не таблица рядом с разметкой.
   */
  const actionLabel = (item) => {
    const action = garmentIntakeAction(item);
    return action ? GARMENT_INTAKE_LABELS[action] : 'Принять изделие';
  };

  const hasIssue = rows.some((e) => garmentIntakeAction(e.item) === 'issue');
  const title = hasIssue
    ? `Приёмка и выдача изделий — ${rows.length}`
    : `Приёмка готового изделия — ${rows.length}`;

  return (
    <section className={styles.matSection}>
      {/*
        ПОЯСНЯЮЩЕЙ СТРОКИ ПОД ЗАГОЛОВКОМ НЕТ (правка 13.09, п. 6): остаётся
        заголовок со счётчиком. Сама зависимость не тронута — блокировку цеха
        нанесения по-прежнему держит этап склада в маршруте, а не этот текст.
      */}
      <div className={styles.fieldLabel}>{title}</div>

      {compact ? (
        <div className={styles.dataCardList} role="list" aria-label="Приёмка готового изделия">
          {rows.map((e) => (
            <div key={e.stage.id} className={styles.dataCard} role="listitem">
              <div className={styles.dataCardHead}>
                <OrderLink orderId={e.order.id} className={styles.dataCardTitle}>
                  {e.order.title}
                </OrderLink>
                <Badge entity="stage" status={e.stage.status} />
              </div>
              <div className={styles.dataCardFields}>
                <div className={styles.dataCardField}>
                  <span className={styles.dataCardFieldLabel}>Изделие</span>
                  <span>{e.item.product_type} · {e.item.qty} шт</span>
                </div>
                <div className={styles.dataCardField}>
                  <span className={styles.dataCardFieldLabel}>Срок</span>
                  <span>{dueLabelCompact(e.order.due_date) || '—'}</span>
                </div>
              </div>
              {e.reason && <div className={styles.subText}>{e.reason}</div>}
              {canAccept && (
                <Button variant="primary" block onClick={() => setIntake(e)}>
                  {actionLabel(e.item)}
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <ScrollHintBox className={styles.tableWrap} label="Приёмка готового изделия">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Заказ</th>
                <th scope="col">Изделие</th>
                <th scope="col">Тираж</th>
                <th scope="col">Срок</th>
                <th scope="col">Состояние</th>
                <th scope="col">Действие</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.stage.id}>
                  <td>
                    <OrderLink orderId={e.order.id}>{e.order.title}</OrderLink>
                  </td>
                  <td>{e.item.product_type}</td>
                  <td>{e.item.qty}</td>
                  <td>{dueLabelCompact(e.order.due_date) || '—'}</td>
                  <td>
                    <Badge entity="stage" status={e.stage.status} />
                    {e.reason && <div className={styles.subText}>{e.reason}</div>}
                  </td>
                  <td>
                    {canAccept ? (
                      <Button variant="primary" onClick={() => setIntake(e)}>
                        {actionLabel(e.item)}
                      </Button>
                    ) : (
                      <span className={styles.subText}>только просмотр</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollHintBox>
      )}

      {intake && (
        <GarmentIntakeModal entry={intake} onClose={() => setIntake(null)} />
      )}
    </section>
  );
}
