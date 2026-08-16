import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ScreenSkeleton } from '../../components/ErpSkeletons';
import { LoadFailed } from '../../components/ErpStates';
import { Button, ButtonLink } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { formatDateShort } from '../../utils/time';
import { MATERIAL_KIND_LABELS, MATERIAL_ROLE_LABELS } from '../../types';
import { useOrderDetail } from '../orderCard/useOrderDetail';
import styles from '../../erp.module.css';

/**
 * Лист закупки для печати (правки заказчика 16.08, п. 15).
 *
 * ЧТО ПРОСИЛ ЗАКАЗЧИК: «лист закупки должен автоматически формироваться системой
 * в PDF; менеджер не должен отдельно вручную делать PDF и потом загружать его.
 * Источником информации остаются структурированные поля ERP».
 *
 * ЧЕМ ФОРМИРУЕТСЯ. Печатной страницей браузера — решение заказчика в этой сессии.
 * В проекте нет ни одной PDF-библиотеки, а правило запрещает добавлять
 * зависимости без обсуждения; печать и «Сохранить в PDF» работают из коробки
 * и ничего не весят в бандле. Тот же приём, что у `components/output/PrintPreview`
 * в Order Studio, включая класс `.no-print` на панели кнопок.
 *
 * ЧЕГО ЭТО НЕ ДЕЛАЕТ, и это надо знать. Документ просит, чтобы PDF сам ложился
 * в документы заказа рядом с ТЗ. Печатная страница так не умеет: файл сохраняет
 * человек. Структурированные данные при этом никуда не деваются — они и есть
 * источник, а страница лишь их представление, и её можно открыть заново в любой
 * момент. Автосохранение в бакет потребует PDF-библиотеки или серверной функции.
 */
export default function PurchaseListPrint() {
  const { orderId } = useParams();
  const { order, notFound, loaded, loadError, loadAll } = useOrderDetail(orderId);

  /**
   * Материалы, сгруппированные по позиции: `item_id = null` — потребность всего
   * заказа (упаковка, бирки одного дизайна), остальные адресованы изделию.
   * Закупщику важно видеть, для чего материал, — иначе «120 м футера» в заказе
   * из трёх изделий не отвечает на вопрос, какого именно.
   */
  const groups = useMemo(() => {
    if (!order) return [];
    const byItem = new Map(order.items.map((it) => [it.id, it]));
    const out = new Map();
    for (const m of order.materials ?? []) {
      const key = m.item_id ?? '';
      if (!out.has(key)) {
        const it = m.item_id ? byItem.get(m.item_id) : null;
        out.set(key, {
          title: it
            ? [it.product_type, it.variant].filter(Boolean).join(' · ')
            : 'На весь заказ',
          item: it ?? null,
          rows: [],
        });
      }
      out.get(key).rows.push(m);
    }
    return [...out.values()];
  }, [order]);

  if (notFound) {
    return (
      <>
        <div className={styles.emptyState}>Заказ не найден или был удалён.</div>
        <ButtonLink to="/purchasing" variant="secondary">К закупке</ButtonLink>
      </>
    );
  }
  if (loadError && !loaded) return <LoadFailed onRetry={loadAll} what="лист закупки" />;
  if (!order) return <ScreenSkeleton />;

  const total = (order.materials ?? []).length;

  return (
    <div className={styles.printPage}>
      <div className={`${styles.toolbar} no-print`}>
        <Link to={`/orders/${orderId}`} className={`${styles.subText} ${styles.cellWithIcon}`}>
          <Icon name="chevronLeft" size={13} />Заказ
        </Link>
        <div className={styles.spacer} />
        <Button variant="primary" onClick={() => window.print()}>
          <Icon name="file" size={14} /> Печать / Сохранить в PDF
        </Button>
      </div>

      <h1 className={styles.printTitle}>Лист закупки</h1>
      <dl className={styles.printFacts}>
        <dt>Заказ</dt>
        <dd>№{order.bitrix_id || '—'} · {order.title}</dd>
        <dt>Клиент</dt>
        <dd>{order.customer || '—'}</dd>
        <dt>Менеджер</dt>
        <dd>{order.manager || '—'}</dd>
        <dt>Запуск</dt>
        <dd>{formatDateShort(order.launch_date) || '—'}</dd>
        <dt>Срок клиента</dt>
        <dd>{formatDateShort(order.due_date) || '—'}</dd>
      </dl>

      {total === 0 ? (
        <p className={styles.subText}>
          Лист закупки пуст — по этому заказу закупка не требуется.
        </p>
      ) : groups.map((g, gi) => (
        <section key={gi} className={styles.printSection}>
          <h2 className={styles.printSectionTitle}>
            {g.title}
            {g.item ? ` — ${g.item.qty} шт` : ''}
          </h2>
          {/* Технический блок изделия печатается рядом с его материалами:
              «твилл плащевый на отделку» без указания изделия закупщику
              ничего не говорит */}
          {g.item?.trim_material && (
            <p className={styles.subText}>Отделочный материал: {g.item.trim_material}</p>
          )}
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Материал</th>
                <th>Цвет</th>
                <th>Тип</th>
                <th>Роль</th>
                <th>Нужно</th>
                <th>Комментарий менеджера</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.name}</strong>{m.article ? ` · ${m.article}` : ''}</td>
                  <td>{m.color || '—'}</td>
                  <td>{MATERIAL_KIND_LABELS[m.kind] || m.kind}</td>
                  <td>{m.role ? (MATERIAL_ROLE_LABELS[m.role] || m.role) : '—'}</td>
                  <td className={styles.progressCell}>
                    {m.qty_expected ?? m.qty ?? '—'}{m.unit ? ` ${m.unit}` : ''}
                  </td>
                  {/* Комментарий МЕНЕДЖЕРА, не закупщика: лист закупки —
                      это исходное задание, а не отчёт о его исполнении */}
                  <td>{m.manager_note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <p className={styles.printFoot}>
        Сформировано системой из полей заказа. План прихода, поставщика, цену
        и фактическое количество заполняет закупщик в разделе «Закупка».
      </p>
    </div>
  );
}
