import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import styles from '../../styles';

/**
 * ПРИВЯЗКА РАЗРАБОТКИ «С ПОЛКИ» К СДЕЛКЕ (правка 14.09).
 *
 * Блок рисуется ТОЛЬКО у разработки без заказа: у привязанной привязывать
 * нечего, а «сменить сделку» — другой вопрос, и сервер его отклоняет. Кнопка,
 * которая отвечает 23505, хуже её отсутствия.
 *
 * ЧТО ПРОИСХОДИТ ПОСЛЕ ПРИВЯЗКИ — сказано прямо, до нажатия. Это решение
 * с последствиями: разработка начинает держать отгрузку заказа, её переписка
 * появляется в чате сделки, а завершение заводит складскую задачу приёмки.
 * Человек вправе знать это заранее, а не обнаружить потом.
 *
 * ФАЙЛЫ ОСТАЮТСЯ У РАЗРАБОТКИ, и об этом тоже сказано: лекала и техпаспорт
 * описывают МОДЕЛЬ, а не тот заказ, из которого она вышла (записанное правило
 * проекта). В списке файлов сделки они не появятся — и это не потеря.
 */
export function DevAttachOrder({ dev, canManage }) {
  const { orders, attach } = useErpStore(useShallow((s) => ({
    orders: s.orders,
    attach: s.attachOrderToDev,
  })));

  const [orderId, setOrderId] = useState('');
  const [itemId, setItemId] = useState('');
  const [saving, setSaving] = useState(false);

  const order = useMemo(
    () => (orderId ? orders.find((o) => o.id === orderId) ?? null : null),
    [orders, orderId],
  );

  if (dev.order_id) return null;

  return (
    <section className={styles.warnBox}>
      <strong>Разработка ведётся без сделки</strong>
      <p className={styles.subText}>
        Привязка включит её в заказ: разработка начнёт держать его отгрузку,
        переписка станет видна в чате сделки, а завершение заведёт складскую
        задачу приёмки. Файлы техпакета останутся у разработки — они описывают
        модель, а не заказ. Сменить сделку потом нельзя.
      </p>

      {!canManage ? (
        <p className={styles.subText}>
          Привязка требует права «Вести разработку образцов».
        </p>
      ) : (
        <>
          <div className={styles.formGrid}>
            <Field
              as="select"
              label="Сделка"
              value={orderId}
              onChange={(e) => { setOrderId(e.target.value); setItemId(''); }}
            >
              <option value="">Выберите сделку</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.bitrix_id ? `№${o.bitrix_id} · ` : ''}{o.title}
                </option>
              ))}
            </Field>
            {/* Позиция — только своя: сервер отвергает чужую (22023), и список,
                предлагающий её, обещал бы действие, которое тут же падает */}
            {order && (order.items ?? []).length > 0 && (
              <Field
                as="select"
                label="Позиция заказа"
                value={itemId}
                hint="Передача задачи в цех заводит этап именно этой позиции"
                onChange={(e) => setItemId(e.target.value)}
              >
                <option value="">Не указывать</option>
                {order.items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.product_type}{it.variant ? ` · ${it.variant}` : ''} — {it.qty} шт
                  </option>
                ))}
              </Field>
            )}
          </div>
          <Button
            disabled={saving || !orderId}
            onClick={async () => {
              setSaving(true);
              await attach(dev.id, orderId, itemId || null);
              setSaving(false);
            }}
          >
            {saving ? 'Привязываем…' : 'Привязать к сделке'}
          </Button>
        </>
      )}
    </section>
  );
}
