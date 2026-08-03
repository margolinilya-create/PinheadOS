import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import InlineEdit from '../../components/InlineEdit';
import { Icon } from '../../components/Icon';
import {
  DICTIONARY_HINTS,
  DICTIONARY_LABELS,
  MATERIAL_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  PACK_SHIP_STATUS_LABELS,
  PROCUREMENT_STATUS_LABELS,
  STAGE_STATUS_LABELS,
  SUBCONTRACT_STATUS_LABELS,
} from '../../types';
import { onTabListKeyDown } from '../../utils/tabs';
import styles from '../../erp.module.css';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { Button } from '../../components/Button';
import { confirm } from '../../../store/useConfirmStore';

/**
 * Справочники производства (правка 12) — редактируются руководством, без правки кода:
 * причины блокировок, типы проблем, типы изделий, поставщики. Значения всплывают
 * подсказками в рабочих экранах (см. DICTIONARY_HINTS).
 *
 * Значения не удаляются, а отключаются: они уже записаны в заказах и истории,
 * физическое удаление сделало бы историю нечитаемой.
 *
 * Отдельная вкладка «Статусы» — только для чтения: статусы зашиты в CHECK-констрейнты
 * и стейт-машины маршрута, склада и подряда; их изменение — это доработка кода,
 * а не запись в справочник. Показываем список, чтобы он был в одном месте с остальными.
 */

const KINDS = ['block_reason', 'problem_type', 'product_type', 'supplier'];

/** Статусы системы — только для чтения */
const STATUS_GROUPS = [
  { title: 'Этап производства', labels: STAGE_STATUS_LABELS },
  { title: 'Заказ', labels: ORDER_STATUS_LABELS },
  { title: 'Материал', labels: MATERIAL_STATUS_LABELS },
  { title: 'Упаковка и отгрузка', labels: PACK_SHIP_STATUS_LABELS },
  { title: 'Задача закупки', labels: PROCUREMENT_STATUS_LABELS },
  { title: 'Подряд', labels: SUBCONTRACT_STATUS_LABELS },
];

function DictionaryList({ kind }) {
  const { dictionaries, createDictionaryItem, updateDictionaryItem, moveDictionaryItem } =
    useErpStore(
      useShallow((s) => ({
        dictionaries: s.dictionaries,
        createDictionaryItem: s.createDictionaryItem,
        updateDictionaryItem: s.updateDictionaryItem,
        moveDictionaryItem: s.moveDictionaryItem,
      })),
    );
  const [draft, setDraft] = useState('');
  const [showHidden, setShowHidden] = useState(false);

  /**
   * Отключение значения справочника — через подтверждение, как и остальные
   * видимые действия админки. Значения тут именно ОТКЛЮЧАЮТСЯ, а не удаляются
   * (правило проекта), и текст обязан это говорить: иначе кнопка выглядит
   * удалением, и её боятся нажимать.
   */
  const onToggleActive = async (item) => {
    if (!item.active) {
      await updateDictionaryItem(item.id, { active: true });
      return;
    }
    const ok = await confirm({
      title: `Отключить «${item.name}»?`,
      message: 'Значение перестанет предлагаться в подсказках. Уже проставленные записи не меняются, вернуть его можно здесь же.',
      confirmLabel: 'Отключить',
    });
    if (ok) await updateDictionaryItem(item.id, { active: false });
  };

  const items = useMemo(
    () => dictionaries
      .filter((d) => d.kind === kind && (showHidden || d.active))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [dictionaries, kind, showHidden],
  );
  /** Сколько значений скрыто фильтром — чтобы «пусто» не врало про пустой справочник */
  const hiddenCount = useMemo(
    () => dictionaries.filter((d) => d.kind === kind && !d.active).length,
    [dictionaries, kind],
  );

  const add = async () => {
    const created = await createDictionaryItem(kind, draft);
    if (created) setDraft('');
  };

  return (
    <>
      <div className={styles.queueReason} style={{ marginBottom: 12 }}>
        {DICTIONARY_HINTS[kind]} Значения не удаляются, а отключаются — уже записанные
        в заказах остаются читаемыми.
      </div>

      <div className={styles.toolbar}>
        <input
          className={styles.input}
          value={draft}
          placeholder={`Новое значение: ${DICTIONARY_LABELS[kind].toLowerCase()}`}
          aria-label={`Новое значение справочника «${DICTIONARY_LABELS[kind]}»`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <Button variant="primary" disabled={!draft.trim()} onClick={add}>
          + Добавить
        </Button>
        <div className={styles.spacer} />
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          Показывать отключённые
        </label>
      </div>

      {items.length === 0 ? (
        <div className={styles.emptyState}>
          {hiddenCount > 0
            ? `Все значения отключены (${hiddenCount}). Включите «Показывать отключённые», чтобы вернуть нужное — заводить дубликат не нужно.`
            : 'Справочник пуст — добавьте первое значение.'}
        </div>
      ) : (
        <ScrollHintBox className={styles.tableWrap} label="Справочник">
          <table className={styles.table}>
            <thead>
              <tr><th>Значение</th><th>Код</th><th>Порядок</th><th>Действие</th></tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.id} style={item.active ? undefined : { opacity: 0.5 }}>
                  <td>
                    <InlineEdit
                      value={item.name}
                      ariaLabel={`Название значения ${item.name}`}
                      onSave={(v) => updateDictionaryItem(item.id, { name: (v || '').trim() || item.name })}
                    />
                    {!item.active && <span className={styles.subText}> · отключено</span>}
                  </td>
                  <td className={styles.subText}>{item.code}</td>
                  <td>
                    <Button
                      variant="ghost"
                      disabled={i === 0}
                      aria-label={`Поднять ${item.name}`}
                      onClick={() => moveDictionaryItem(item.id, 'up', items[i - 1]?.id)}>
                      <Icon name="arrowUp" size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={i === items.length - 1}
                      aria-label={`Опустить ${item.name}`}
                      onClick={() => moveDictionaryItem(item.id, 'down', items[i + 1]?.id)}>
                      <Icon name="arrowDown" size={14} />
                    </Button>
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      onClick={() => onToggleActive(item)}>
                      {item.active
                        ? (
                          <span className={styles.cellWithIcon}>
                            <Icon name="x" size={13} /> Отключить
                          </span>
                        )
                        : 'Вернуть'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollHintBox>
      )}
    </>
  );
}

function StatusesList() {
  return (
    <>
      <div className={styles.queueReason} style={{ marginBottom: 12 }}>
        Статусы — часть маршрутной логики: они зашиты в ограничения базы и в переходы
        производства, склада и подряда. Переименовать их из админки нельзя — это доработка
        кода. Список здесь для справки.
      </div>
      {STATUS_GROUPS.map((g) => (
        <section key={g.title} className={styles.matSection}>
          <div className={styles.matSectionHead}><strong>{g.title}</strong></div>
          <div className={styles.checkRow}>
            {Object.entries(g.labels).map(([code, label]) => (
              <span key={code} className={`${styles.chip} ${styles.chipNeutral}`} title={code}>
                {label}
              </span>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export function DictionariesTab() {
  const { dictionariesLoaded, loadDictionaries } = useErpStore(
    useShallow((s) => ({
      dictionariesLoaded: s.dictionariesLoaded,
      loadDictionaries: s.loadDictionaries,
    })),
  );
  const [kind, setKind] = useState('block_reason');

  useEffect(() => {
    if (!dictionariesLoaded) loadDictionaries();
  }, [dictionariesLoaded, loadDictionaries]);

  return (
    <>
      <div className={styles.deptTabs} role="tablist" aria-label="Справочники" onKeyDown={onTabListKeyDown}>
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`dict-tab-${k}`}
            aria-controls="dict-tabpanel"
            aria-selected={kind === k}
            tabIndex={kind === k ? 0 : -1}
            className={`${styles.deptTab} ${kind === k ? styles.deptTabActive : ''}`}
            onClick={() => setKind(k)}
          >
            {DICTIONARY_LABELS[k]}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          id="dict-tab-statuses"
          aria-controls="dict-tabpanel"
          aria-selected={kind === 'statuses'}
          tabIndex={kind === 'statuses' ? 0 : -1}
          className={`${styles.deptTab} ${kind === 'statuses' ? styles.deptTabActive : ''}`}
          onClick={() => setKind('statuses')}
        >
          Статусы
        </button>
      </div>

      <div id="dict-tabpanel" role="tabpanel" aria-labelledby={`dict-tab-${kind}`} tabIndex={-1}>
        {kind === 'statuses' ? <StatusesList /> : <DictionaryList key={kind} kind={kind} />}
      </div>
    </>
  );
}
