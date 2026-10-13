import styles from '../../styles';
import { AcceptMaterialForm } from './AcceptMaterialForm';

/**
 * Задача склада «Приёмка материалов» (правка 4.1.3): сравнение План↔Факт по каждому материалу.
 * План (материал/цвет/артикул/кол-во) заводит закупка и он read-only для склада; кладовщик вносит
 * только факт (что фактически поступило + кол-во) и статус приёмки. Приёмка разблокирует закрой
 * (гейт в routes.ts) и закрывает задачу в warehouseSlice.acceptMaterial.
 *
 * Форма одного материала — `AcceptMaterialForm` (вынесена 05.10, п. 4: ратчет
 * размера; там же новая компоновка — рулоны строками, итог в закреплённом низу).
 */

export function MaterialReceiptCard({
  order, task, onAccept, onSetRollWeights, onSetRollParams = null, onAddRolls = null,
}) {
  const accepted = task.status === 'accepted';
  /**
   * ЗАДАЧА ПРИНАДЛЕЖИТ ПОЗИЦИИ ЗАКУПКИ (правка 12.09, баг 01): её заводит
   * переход этой позиции в статус «В пути», и склад видит РОВНО то, что
   * физически едет. Прежде карточка показывала все материалы заказа —
   * в том числе не заказанные, — и предлагала их принять.
   *
   * `material_id` пуст у приёмок, закрытых до правки: там показываем список
   * по-старому, иначе история осталась бы без содержимого.
   */
  const own = task.material_id
    ? order.materials.filter((m) => m.id === task.material_id)
    : order.materials;
  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <div>
          <span className={styles.subText}>Приёмка материалов</span>
          <div><strong>№{order.bitrix_id || '—'} · {order.title}</strong></div>
        </div>
        {accepted && <span className={`${styles.chip} ${styles.chipDone}`}>Материалы приняты</span>}
      </div>
      {own.length === 0 ? (
        /* Позиция удалена из закупки после того, как уехала: задача осталась,
           а показывать нечего — говорим это прямо, иначе пустая карточка
           читается как поломка (заголовок есть, под ним ничего) */
        <p className={styles.subText}>
          Позиция закупки, к которой относится эта приёмка, больше не заведена
          в заказе.
        </p>
      ) : own.map((m) => (
        <AcceptMaterialForm
          key={m.id}
          material={m}
          onAccept={onAccept}
          onSetRollWeights={onSetRollWeights}
          onSetRollParams={onSetRollParams}
          onAddRolls={onAddRolls}
        />
      ))}
    </section>
  );
}
