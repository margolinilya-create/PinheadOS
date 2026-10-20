import { useId, useMemo, useState } from 'react';
import { MentionPicker } from '../../components/chat/MentionPicker';
import { Button } from '../../components/Button';
import styles from './BizTaskCreateForm.module.css';

/** Сколько людей показывать в подсказке: дальше — уточнить набором */
const SHOWN = 8;

/**
 * Выбор людей для бизнес-задачи — ответственного (один) или наблюдателей
 * (несколько, до `max`). Подсказка — тот же `MentionPicker`, что у @упоминаний
 * в чате, на том же справочнике `erp_chat_directory()`: две таблицы имён
 * разошлись бы в первую же правку.
 *
 * `people` уже отобраны вызывающим: ответственным и наблюдателем бывает только
 * сотрудник ERP (`role` из активной карточки), иначе писатель ответит 22023.
 *
 * Клавиатура как у композера: ↑/↓ — выбор, Enter — подставить, Escape —
 * закрыть. Поле — `combobox`, список связан с ним `aria-controls`.
 */
export function PersonPicker({ label, people, value, onChange, multiple = false, max = Infinity }) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const byId = useMemo(() => new Map(people.map((p) => [p.user_id, p])), [people]);
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => !value.includes(p.user_id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q))
      .slice(0, SHOWN);
  }, [people, value, query]);

  const full = multiple ? value.length >= max : value.length > 0;

  const pick = (p) => {
    onChange(multiple ? [...value, p.user_id] : [p.user_id]);
    setQuery('');
    setActive(0);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (!open && e.key === 'ArrowDown') { setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && options[active]) { e.preventDefault(); pick(options[active]); }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {!multiple && <span className={styles.required} aria-hidden="true">*</span>}
      </label>
      {value.length > 0 && (
        <ul className={styles.chips} aria-label={multiple ? `${label}: выбраны` : `${label}: выбран`}>
          {value.map((uid) => {
            const name = byId.get(uid)?.name ?? '—';
            return (
              <li key={uid} className={styles.chip}>
                {name}
                <Button
                  variant="ghost"
                  size="sm"
                  icon="x"
                  iconOnly
                  aria-label={`Убрать: ${name}`}
                  onClick={() => onChange(value.filter((v) => v !== uid))}
                />
              </li>
            );
          })}
        </ul>
      )}
      {!full && (
        <div className={styles.pickerWrap}>
          <input
            id={id}
            className={styles.control}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            autoComplete="off"
            placeholder="Имя или почта"
            value={query}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
            onKeyDown={onKeyDown}
          />
          {open && (
            <MentionPicker
              id={listId}
              label={label}
              className={styles.below}
              people={options}
              activeIndex={active}
              onPick={pick}
              emptyHint="Никого не нашли среди сотрудников ERP"
            />
          )}
        </div>
      )}
    </div>
  );
}
