import { useId, useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { Button } from '../../components/Button';
import { checklistLeft } from './bizTaskCardView';
import styles from './BizTaskCard.module.css';

/** Пределы писателя `erp_biz_task_checklist_op` (Р8) */
const MAX_ITEMS = 100;
const ITEM_MAX = 500;

/**
 * ЧЕК-ЛИСТ ЗАДАЧИ (правки 19.10, п. 7): пункты отмечают ответственный,
 * постановщик и руководитель с правом (`toggle_item`); добавляют и убирают —
 * постановщик и руководитель (`checklist`). Наблюдатель видит пункты, но
 * не отмечает: вместо флажка — текст «сделано / не сделано».
 *
 * Без оптимистики: флажок встаёт по ответу писателя, на время запроса
 * пункт `disabled` (правило проекта: `disabled` — только на время запроса).
 */
export function BizTaskChecklist({ taskId, items, canToggle, canEdit }) {
  const op = useErpStore((s) => s.bizTaskChecklistOp);
  const headId = useId();
  const [busy, setBusy] = useState(null);
  const [draft, setDraft] = useState('');
  const { left, total } = checklistLeft(items);

  const run = async (key, kind, item) => {
    setBusy(key);
    const row = await op(taskId, kind, item);
    setBusy(null);
    return row;
  };

  const add = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (await run('add', 'add', { text })) setDraft('');
  };

  if (total === 0 && !canEdit) return null;

  return (
    <section className={styles.block} aria-labelledby={headId}>
      <h2 id={headId} className={styles.blockTitle}>
        Чек-лист{total > 0 && <span className={styles.muted}> · сделано {total - left} из {total}</span>}
      </h2>
      {total > 0 && (
        <ul className={styles.checklist}>
          {items.map((c) => (
            <li key={c.id} className={styles.checkItem}>
              {canToggle ? (
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={c.done}
                    disabled={busy === c.id}
                    onChange={() => run(c.id, 'toggle', { id: c.id, done: !c.done })}
                  />
                  <span className={c.done ? styles.checkDone : undefined}>{c.text}</span>
                </label>
              ) : (
                <span className={c.done ? styles.checkDone : undefined}>
                  {c.text}
                  <span className={styles.muted}>{c.done ? ' — сделано' : ' — не сделано'}</span>
                </span>
              )}
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="x"
                  iconOnly
                  aria-label={`Убрать пункт: ${c.text}`}
                  disabled={busy === `rm-${c.id}`}
                  onClick={() => run(`rm-${c.id}`, 'remove', { id: c.id })}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && total < MAX_ITEMS && (
        <form className={styles.checkAdd} onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <input
            className={styles.control}
            aria-label="Новый пункт чек-листа"
            placeholder="Новый пункт"
            maxLength={ITEM_MAX}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            icon="plus"
            loading={busy === 'add'}
            ariaDisabledReason={draft.trim() ? '' : 'Введите текст пункта'}
          >
            Добавить пункт
          </Button>
        </form>
      )}
    </section>
  );
}
