import { useState } from 'react';
import { FilterBar } from './FilterBar';
import { deptShortName } from '../data/departments';
import {
  EMPTY_FILTERS,
  GROUP_FILTER_LABELS,
  NO_ASSIGNEE,
  SORT_LABELS,
  hasActiveFilters,
} from '../utils/filterStages';
import styles from '../erp.module.css';
import { Icon } from './Icon';
import { DateField } from './DateField';

/**
 * Общая панель фильтров производственных заданий (правка 9) — очередь цеха,
 * канбан, производственный план. Поиск и три быстрых переключателя всегда на виду,
 * остальное (цех, статус, исполнитель, срок) — в раскрывающемся блоке, чтобы
 * не занимать экран цеха. Состояние живёт в URL — см. filtersFromParams.
 */
export function QueueFilters({
  filters,
  onChange,
  departments = [],
  assignees = [],
  showDept = true,
  right = null,
}) {
  const [expanded, setExpanded] = useState(false);
  const set = (patch) => onChange({ ...filters, ...patch });
  const active = hasActiveFilters(filters);

  const toggleChip = (key, label, title) => (
    <button
      key={key}
      type="button"
      aria-pressed={filters[key]}
      title={title}
      className={`${styles.chip} ${styles.chipBtn} ${filters[key] ? styles.chipProgress : styles.chipNeutral}`}
            onClick={() => set({ [key]: !filters[key] })}
    >
      {label}
    </button>
  );

  return (
    <>
      <FilterBar
        search={filters.q}
        onSearch={(v) => set({ q: v })}
        searchPlaceholder="Поиск: заказ, № сделки, клиент, изделие, материал"
        searchLabel="Поиск по заданиям"
        right={right}
      >
        {toggleChip('readyOnly', 'Готово к запуску', 'Только задания, которые можно запускать')}
        {toggleChip(
          'overdue',
          <><Icon name="clock" size={13} /> Просрочено</>,
          'Только просроченные по сроку клиента или плану этапа',
        )}
        {toggleChip(
          'problem',
          <><Icon name="ban" size={13} /> С проблемой</>,
          'Заблокированные и с возвратом брака',
        )}
        <button
          type="button"
          aria-expanded={expanded}
          className={`${styles.chip} ${styles.chipBtn} ${expanded ? styles.chipProgress : styles.chipNeutral}`}
                    onClick={() => setExpanded((v) => !v)}
        >
          Фильтры <Icon name="chevronDown" size={13} className={expanded ? styles.chevronUp : undefined} />
        </button>
        {active && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onChange({ ...EMPTY_FILTERS })}
          >
            Сбросить
          </button>
        )}
      </FilterBar>

      {expanded && (
        <div className={styles.filterPanel}>
          {showDept && departments.length > 0 && (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Цех</span>
              <select
                className={styles.select}
                value={filters.dept}
                onChange={(e) => set({ dept: e.target.value })}
                aria-label="Фильтр по цеху"
              >
                <option value="">Все цеха</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{deptShortName(d.code, d.name)}</option>
                ))}
              </select>
            </label>
          )}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Статус</span>
            <select
              className={styles.select}
              value={filters.status}
              onChange={(e) => set({ status: e.target.value })}
              aria-label="Фильтр по статусу"
            >
              <option value="">Любой</option>
              {Object.entries(GROUP_FILTER_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Исполнитель</span>
            <select
              className={styles.select}
              value={filters.assignee}
              onChange={(e) => set({ assignee: e.target.value })}
              aria-label="Фильтр по исполнителю"
            >
              <option value="">Любой</option>
              <option value={NO_ASSIGNEE}>Не закреплено</option>
              {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Срок с</span>
            <DateField
              value={filters.dueFrom}
              onChange={(v) => set({ dueFrom: v })}
              aria-label="Срок клиента с"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Срок по</span>
            <DateField
              value={filters.dueTo}
              onChange={(v) => set({ dueTo: v })}
              aria-label="Срок клиента по"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Сортировка</span>
            <select
              className={styles.select}
              value={filters.sort}
              onChange={(e) => set({ sort: e.target.value })}
              aria-label="Сортировка заданий"
            >
              {Object.entries(SORT_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </>
  );
}
