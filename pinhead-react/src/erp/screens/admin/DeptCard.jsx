import { memo, useMemo } from 'react';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/Button';
import styles from '../../styles';
import {
  DeptFlags, DeptName, GateKinds, HeadSelect, NormDaysInput, ResultFieldsCell, SortOrderInput,
} from './DeptFields';

/**
 * Участок карточкой вместо строки таблицы — компактная раскладка
 * (планшет и телефон).
 *
 * Зачем: колонок девять, и колонка «Действие» («Отключить» / «Вернуть»)
 * стоит последней — ниже 1024px она уезжала за край, а вместе с ней и
 * настройка гейта, из-за которой участок либо стоит без материалов, либо
 * не ждёт их вовсе.
 *
 * Подписи ставятся ЯВНО: без шапки таблицы «10» и «3» — два числа подряд,
 * а это порядок в потоке и норматив в днях, вещи несравнимые. Наборы галочек
 * («Признаки», «Ждёт материалы») подписаны по той же причине: без подписи
 * два столбца чекбоксов читаются как один длинный список.
 *
 * Главное действие — `Button block`: примитив уже даёт ширину и ≥44px
 * на тач-экранах.
 */
/**
 * Обработчики приходят СТАБИЛЬНЫМИ и без привязки к участку (`onUpdate(id, patch)`,
 * `onToggleProduction(dept, next)` …), а привязывает их сама карточка. Иначе
 * экран создавал по набору стрелок на строку, и `memo` не срабатывал никогда.
 */
function DeptCardBase({
  dept, headCandidates, onUpdate, onToggleProduction, onToggleGateKind, onToggleActive,
}) {
  const h = useMemo(() => ({
    rename: (name) => onUpdate(dept.id, { name }),
    sortOrder: (v) => onUpdate(dept.id, { sort_order: v }),
    production: (next) => onToggleProduction(dept, next),
    branding: (next) => onUpdate(dept.id, { is_branding: next }),
    overPlan: (next) => onUpdate(dept.id, { allows_over_plan: next }),
    gateKind: (kind, on) => onToggleGateKind(dept, kind, on),
    resultFields: (fields) => onUpdate(dept.id, { result_fields: fields }),
    head: (id) => onUpdate(dept.id, { head_employee_id: id }),
    normDays: (v) => onUpdate(dept.id, { norm_days: v }),
    active: () => onToggleActive(dept),
  }), [dept, onUpdate, onToggleProduction, onToggleGateKind, onToggleActive]);

  return (
    <article
      className={`${styles.dataCard} ${dept.active ? '' : styles.rowDisabled}`}
      aria-label={`Участок ${dept.name}`}
    >
      <div className={styles.dataCardHead}>
        <strong><DeptName dept={dept} onRename={h.rename} /></strong>
        <span className={styles.subText}>{dept.code}</span>
      </div>

      <div className={styles.dataCardFields}>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Порядок</span>
          <SortOrderInput dept={dept} onChange={h.sortOrder} />
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Норматив, дн</span>
          <NormDaysInput dept={dept} onChange={h.normDays} />
        </span>
      </div>

      <div className={styles.dataCardField}>
        <span className={styles.dataCardFieldLabel}>Руководитель</span>
        <HeadSelect dept={dept} candidates={headCandidates} onChange={h.head} />
      </div>

      <div className={styles.dataCardRow}>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Признаки</span>
          <DeptFlags
            dept={dept}
            onToggleProduction={h.production}
            onToggleBranding={h.branding}
            onToggleOverPlan={h.overPlan}
          />
        </span>
      </div>

      <div className={styles.dataCardRow}>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Ждёт материалы</span>
          <GateKinds dept={dept} onToggle={h.gateKind} />
        </span>
      </div>

      <div className={styles.dataCardRow}>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Отчёт участка</span>
          <ResultFieldsCell dept={dept} onSave={h.resultFields} />
        </span>
      </div>

      <Button variant="secondary" block onClick={h.active}>
        {dept.active ? (
          <span className={styles.cellWithIcon}><Icon name="x" size={14} /> Отключить участок</span>
        ) : 'Вернуть участок'}
      </Button>
    </article>
  );
}

export const DeptCard = memo(DeptCardBase);
