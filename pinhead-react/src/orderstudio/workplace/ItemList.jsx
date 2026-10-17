import { useEffect, useRef, useState } from 'react';
import { confirm } from '../../store/useConfirmStore';
import { confirmSplit } from './confirmSplit';
import { itemTitle } from '../model/itemOps';
import { Icon } from '../../erp/components/Icon';
import ColorCopyDialog from './ColorCopyDialog';
import styles from './Workplace.module.css';

/**
 * Список изделий заказа на рабочем месте (веха 3).
 *
 * Компонент только спрашивает и сообщает: копию, разнесение и удаление
 * делает родитель (`onCopyColor(key, color)`, `onSplit(key)`, `onRemove(key)`)
 * через `model/itemOps` и `useSalesStore.edit`. Удаление и разнесение уходят
 * в базу автосохранением без отмены — поэтому перед ними подтверждение.
 *
 * Фокус: после удаления или разнесения — на соседней позиции (следующей,
 * у последней — предыдущей), иначе он падал бы на `body` вместе с кнопкой.
 *
 * Названия — текстом React (никакой разметки из данных).
 *
 * `compact` (ширина ≤ 760): вместо списка — выпадающий список позиций,
 * рядом меню «Действия с изделием» выбранной позиции и «+ Изделие».
 */
export default function ItemList({
  order, selectedKey, onSelect, onAdd, onCopyColor, onRemove, onSplit, readOnly = false, compact = false,
}) {
  const items = order.items;
  const [menuKey, setMenuKey] = useState(null);
  const [copyKey, setCopyKey] = useState(null);
  /**
   * Куда перевести фокус, когда родитель перерисует список:
   * `{ key }` — на позицию, `{ after }` — на следующую за позицией `after`
   * (после разнесения: ключ первой новой заранее неизвестен), `{ add: true }` —
   * на «+ Изделие» (позиций не осталось). Ref, а не состояние: срабатывает
   * по смене `items`, лишней перерисовки не нужно.
   */
  const pendingFocus = useRef(null);
  const selectRefs = useRef(new Map());
  const toggleRefs = useRef(new Map());
  const addRef = useRef(null);

  useEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    pendingFocus.current = null;
    let el = null;
    if (want.add) el = addRef.current;
    else if (want.key) el = selectRefs.current.get(want.key);
    else if (want.after) {
      const i = items.findIndex((it) => it.key === want.after);
      const next = i >= 0 ? (items[i + 1] ?? items[i]) : null;
      el = next ? selectRefs.current.get(next.key) : addRef.current;
    }
    el?.focus();
  }, [items]);

  const closeMenu = (key, returnFocus) => {
    setMenuKey(null);
    if (returnFocus) toggleRefs.current.get(key)?.focus();
  };

  const remove = async (item, index) => {
    setMenuKey(null);
    const title = itemTitle(item);
    const ok = await confirm({
      title: `Удалить «${title}»?`,
      message: 'Нанесения и бирки удалятся вместе с ней',
      confirmLabel: 'Удалить позицию',
      variant: 'danger',
    });
    if (!ok) return;
    const neighbour = items[index + 1] ?? items[index - 1];
    pendingFocus.current = neighbour ? { key: neighbour.key } : { add: true };
    onRemove(item.key);
  };

  const split = async (item) => {
    setMenuKey(null);
    if (!(await confirmSplit(item))) return;
    pendingFocus.current = { after: item.key };
    onSplit(item.key);
  };

  const copyItem = copyKey ? items.find((it) => it.key === copyKey) : null;

  /** Меню «Действия» позиции: копия в другом цвете, разнесение, удаление */
  const renderActions = (item, index) => {
    const title = itemTitle(item);
    const menuOpen = menuKey === item.key;
    const menuId = `item-actions-${item.key}`;
    return (
      <div className={styles.itemActions}>
        <button
          type="button"
          ref={(el) => setRef(toggleRefs.current, item.key, el)}
          className={styles.itemMenuToggle}
          aria-label={`Действия с изделием «${title}»`}
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          onClick={() => setMenuKey(menuOpen ? null : item.key)}
        >
          Действия
          <Icon name={menuOpen ? 'chevronUp' : 'chevronDown'} size={14} />
        </button>
        {menuOpen && (
          // Escape из любой кнопки меню закрывает его и возвращает фокус
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions
          <div
            id={menuId}
            className={styles.itemMenu}
            onKeyDown={(e) => { if (e.key === 'Escape') closeMenu(item.key, true); }}
          >
            <button
              type="button"
              className={styles.itemMenuBtn}
              aria-label={`Копия в другом цвете… — ${title}`}
              onClick={() => { setMenuKey(null); setCopyKey(item.key); }}
            >
              Копия в другом цвете…
            </button>
            {item.size_grid.rows.length > 1 && (
              <button
                type="button"
                className={styles.itemMenuBtn}
                aria-label={`Разнести по цветам — ${title}`}
                onClick={() => split(item)}
              >
                Разнести по цветам
              </button>
            )}
            <button
              type="button"
              className={`${styles.itemMenuBtn} ${styles.itemMenuDanger}`}
              aria-label={`Удалить — ${title}`}
              onClick={() => remove(item, index)}
            >
              Удалить
            </button>
          </div>
        )}
      </div>
    );
  };

  const addButton = !readOnly && (
    <button type="button" ref={addRef} className={styles.itemAdd} onClick={onAdd}>
      + Изделие
    </button>
  );

  const copyDialog = copyItem && (
    <ColorCopyDialog
      itemName={itemTitle(copyItem)}
      onClose={() => setCopyKey(null)}
      onSubmit={(color) => {
        setCopyKey(null);
        onCopyColor(copyItem.key, color);
      }}
    />
  );

  if (compact) {
    const index = items.findIndex((it) => it.key === selectedKey);
    const selected = items[index];
    return (
      <div className={styles.itemBar}>
        {items.length > 0 && (
          <select
            className={styles.itemPicker}
            aria-label="Изделие"
            value={selected?.key ?? ''}
            ref={(el) => { if (selected) setRef(selectRefs.current, selected.key, el); }}
            onChange={(e) => onSelect(e.target.value)}
          >
            {items.map((item) => <option key={item.key} value={item.key}>{itemTitle(item)}</option>)}
          </select>
        )}
        {!readOnly && selected && renderActions(selected, index)}
        {addButton}
        {copyDialog}
      </div>
    );
  }

  return (
    <div className={styles.itemList}>
      {/* role явно: Safari снимает роль списка у `ul` без маркеров */}
      {/* eslint-disable-next-line jsx-a11y/no-redundant-roles */}
      <ul role="list" className={styles.items} aria-label="Изделия заказа">
        {items.map((item, index) => {
          const selected = item.key === selectedKey;
          return (
            <li key={item.key} className={styles.itemRow}>
              <button
                type="button"
                ref={(el) => setRef(selectRefs.current, item.key, el)}
                className={`${styles.itemSelect} ${selected ? styles.itemSelected : ''}`.trim()}
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelect(item.key)}
              >
                {itemTitle(item)}
              </button>
              {!readOnly && renderActions(item, index)}
            </li>
          );
        })}
      </ul>
      {addButton}
      {copyDialog}
    </div>
  );
}

function setRef(map, key, el) {
  if (el) map.set(key, el);
  else map.delete(key);
}
