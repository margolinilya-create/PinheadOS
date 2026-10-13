import { useState } from 'react';
import { FilterBar } from './FilterBar';
import { deptShortName } from '../data/departments';
import {
  EMPTY_FILTERS,
  GROUP_FILTER_LABELS,
  NO_ASSIGNEE,
  ORIGIN_FILTER_LABELS,
  OVERDUE_FILTER_LABELS,
  SORT_LABELS,
  hasActiveFilters,
} from '../utils/filterStages';
import styles from '../erp.module.css';
import { Icon } from './Icon';
import { DateField } from './DateField';
import { Button } from '../components/Button';
import { FilterChip } from './FilterChip';

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
    <FilterChip
      key={key}
      active={Boolean(filters[key])}
      title={title}
      onClick={() => set({ [key]: !filters[key] })}
    >
      {label}
    </FilterChip>
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
        {/*
          Быстрый чип отвечает на самый частый вопрос — «что горит вообще».
          Какая именно просрочка (срок заказа, план этапа или его отсутствие)
          выбирается ниже, в раскрытых фильтрах: это уже разбор, а не сигнал.
          Одно поле, два уровня подробности — как «Готово к запуску» и «Статус».
        */}
        <FilterChip
          active={Boolean(filters.overdue)}
          title="Просроченные по сроку клиента или по плану этапа. Уточнить вид — в фильтрах ниже"
          onClick={() => set({ overdue: filters.overdue ? '' : 'any' })}
        >
          <Icon name="clock" size={13} />
          {' '}
          {filters.overdue && filters.overdue !== 'any'
            ? OVERDUE_FILTER_LABELS[filters.overdue]
            : 'Просрочено'}
        </FilterChip>
        {toggleChip(
          'problem',
          <><Icon name="ban" size={13} /> С проблемой</>,
          'Заблокированные и с возвратом брака',
        )}
        {/*
          «Только образцы» (документ заказчика 12.08, п.7): цеха нанесения
          обслуживают и серию, и разработку ЭКС — отдельного «экс-цеха
          нанесений» заводить не нужно, нужен фильтр. Иконка та же, что
          у бейджа «образец» в строке очереди: одно понятие — один знак.
          Второй вариант отбора («Только серия») живёт в раскрытых фильтрах —
          чип отвечает на частый вопрос, селект на редкий.
        */}
        <FilterChip
          active={filters.origin === 'experimental'}
          title="Только нанесения и работы по разработкам экспериментального цеха"
          onClick={() => set({ origin: filters.origin === 'experimental' ? '' : 'experimental' })}
        >
          <Icon name="flask" size={13} />
          {' '}
          Только образцы
        </FilterChip>
        <FilterChip expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          Фильтры <Icon name="chevronDown" size={13} className={expanded ? styles.chevronUp : undefined} />
        </FilterChip>
        {active && (
          <Button variant="ghost" onClick={() => onChange({ ...EMPTY_FILTERS })}>
            Сбросить
          </Button>
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
            <span className={styles.fieldLabel}>Просрочка</span>
            <select
              className={styles.select}
              value={filters.overdue}
              onChange={(e) => set({ overdue: e.target.value })}
              aria-label="Вид просрочки"
            >
              <option value="">Неважно</option>
              {Object.entries(OVERDUE_FILTER_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Происхождение</span>
            <select
              className={styles.select}
              value={filters.origin}
              onChange={(e) => set({ origin: e.target.value })}
              aria-label="Происхождение задания"
            >
              <option value="">Неважно</option>
              {Object.entries(ORIGIN_FILTER_LABELS).map(([v, l]) => (
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
