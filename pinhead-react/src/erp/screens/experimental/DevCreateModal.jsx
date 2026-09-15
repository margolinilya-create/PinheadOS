import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import styles from '../../styles';

/**
 * ЗАВЕСТИ РАЗРАБОТКУ РУКАМИ (правка 14.09 — «разработка без сделки»).
 *
 * ДО 15.09 ФОРМЫ НЕ БЫЛО ВОВСЕ: разработка рождалась ТОЛЬКО побочным
 * действием создания заказа с позицией-образцом (`orderWriteSlice`). То есть
 * требование «вести разработку без сделки» упиралось не в колонку `NOT NULL`,
 * а в отсутствие входа — и снятие ограничения в одиночку не дало бы ни одной
 * новой разработки.
 *
 * СДЕЛКА ЗДЕСЬ НЕОБЯЗАТЕЛЬНА, и это единственное, чем форма отличается
 * от прежнего автоматического пути. Пустое поле означает «на полку»:
 * технолог прорабатывает модель заранее, а привяжет её к заказу, когда тот
 * появится (`attachOrderToDev`). Переписка при этом не копируется — тред
 * анкерится на разработку, и чат сделки собирает её сам.
 *
 * ПОЗИЦИЯ ПРЕДЛАГАЕТСЯ ТОЛЬКО ПОСЛЕ ВЫБОРА СДЕЛКИ и только своя: сервер
 * отвергает позицию чужого заказа (22023), и список, предлагающий её,
 * обещал бы действие, которое тут же падает.
 */
export function DevCreateModal({ onClose, onCreated }) {
  const { orders, create } = useErpStore(useShallow((s) => ({
    orders: s.orders,
    create: s.createExperimental,
  })));

  const [form, setForm] = useState({ techName: '', orderId: '', itemId: '' });
  const [saving, setSaving] = useState(false);

  const order = useMemo(
    () => (form.orderId ? orders.find((o) => o.id === form.orderId) ?? null : null),
    [orders, form.orderId],
  );

  const submit = async () => {
    setSaving(true);
    const row = await create(form.orderId || null, {
      item_id: form.itemId || null,
      tech_name: form.techName.trim() || null,
    });
    setSaving(false);
    if (row) {
      onCreated?.(row);
      onClose();
    }
  };

  return (
    <Modal title="Новая разработка" onClose={onClose}>
      <div className={styles.formGrid}>
        <Field
          label="Техническое название"
          required
          autoFocus
          value={form.techName}
          placeholder="Худи оверсайз 320, футер петля"
          hint="Как модель называют между собой технолог и цех"
          onChange={(e) => setForm({ ...form, techName: e.target.value })}
        />
        <Field
          as="select"
          label="Сделка"
          value={form.orderId}
          hint="Можно не выбирать: разработку «на полку» привязывают к сделке позже"
          onChange={(e) => setForm({ ...form, orderId: e.target.value, itemId: '' })}
        >
          <option value="">Без сделки — на полку</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.bitrix_id ? `№${o.bitrix_id} · ` : ''}{o.title}
            </option>
          ))}
        </Field>
        {/*
          Позиция принадлежит выбранной сделке — иначе `erp_experimental_task_send`
          завёл бы этап в чужом заказе. Пока сделка не выбрана, спрашивать
          нечего: поля нет вовсе, а не пустой список, который выглядит поломкой
        */}
        {order && (order.items ?? []).length > 0 && (
          <Field
            as="select"
            label="Позиция заказа"
            value={form.itemId}
            hint="Передача задачи в цех заводит этап именно этой позиции"
            onChange={(e) => setForm({ ...form, itemId: e.target.value })}
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
      <div className={styles.modalActions}>
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button disabled={saving || !form.techName.trim()} onClick={submit}>
          {saving ? 'Заводим…' : 'Завести'}
        </Button>
      </div>
    </Modal>
  );
}
