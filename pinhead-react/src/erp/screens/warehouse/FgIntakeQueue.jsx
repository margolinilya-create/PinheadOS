import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { buildQueueEntries } from '../../utils/queueEntries';
import { WAREHOUSE_DEPT_CODE, materialsForItem } from '../../utils/routes';
import { materialsAfterBypass } from '../../utils/bypass';
import { confirmStageDone } from '../../utils/stageDone';
import { OrderLink } from '../../components/OrderLink';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { useCompactLayout } from '../../layout/useCompactLayout';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { dueLabelCompact } from '../../utils/format';
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
  const { orders, departments, bypasses, setStageStatus } = useErpStore(useShallow((s) => ({
    orders: s.orders,
    departments: s.departments,
    bypasses: s.bypasses,
    setStageStatus: s.setStageStatus,
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

  const canComplete = access.can('stage.complete') && access.canActIn(deptId);

  if (!deptId || rows.length === 0) return null;

  /**
   * Закрытие идёт через `confirmStageDone` — общий гейт закрытия этапа,
   * а не голым `setStageStatus`: он считает недосдачу, называет
   * разблокируемые этапы и уважает аварийное снятие проверок. Материалы
   * отбираются ПО ПОЗИЦИИ и с учётом снятия — иначе гейт судил бы
   * по чужим строкам закупки, а диалог отказал бы там, где система уже
   * разрешила (сторож `stageDone.test.ts` читает исходники вызывающих).
   *
   * У склада `gate_material_kinds` пуст, то есть материалы его не держат
   * (fail-open), — но правило одно на всех вызывающих, и «здесь всё равно
   * не сработает» это ровно тот довод, из-за которого копии расходятся.
   */
  const accept = async (entry) => {
    const stageDept = departments.find((d) => d.id === entry.stage.department_id) ?? null;
    const ok = await confirmStageDone({
      stage: entry.stage,
      qty: entry.item.qty ?? 0,
      allStages: entry.item.stages ?? [],
      departments,
      materials: materialsAfterBypass(
        materialsForItem(entry.order.materials, entry.item.id), entry.order.id, bypasses),
      dept: stageDept,
    });
    if (!ok) return;
    await setStageStatus(entry.stage.id, 'done');
  };

  const title = `Приёмка готового изделия — ${rows.length}`;

  return (
    <section className={styles.matSection}>
      <div className={styles.fieldLabel}>{title}</div>
      <p className={styles.subText}>
        Изделия клиента, которые нужно принять ДО нанесения: пока приёмка
        не закрыта, цех нанесения работу не увидит.
      </p>

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
              {canComplete && (
                <Button variant="primary" block onClick={() => accept(e)}>
                  Принять изделие
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
                    {canComplete ? (
                      <Button variant="primary" onClick={() => accept(e)}>
                        Принять изделие
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
    </section>
  );
}
