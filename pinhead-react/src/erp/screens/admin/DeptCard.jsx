import { memo } from 'react';
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
function DeptCardBase({
  dept, headCandidates, onRename, onSortOrder, onToggleProduction, onToggleBranding,
  onToggleGateKind, onSaveResultFields, onHead, onNormDays, onToggleActive,
}) {
  return (
    <article
      className={`${styles.dataCard} ${dept.active ? '' : styles.rowDisabled}`}
      aria-label={`Участок ${dept.name}`}
    >
      <div className={styles.dataCardHead}>
        <strong><DeptName dept={dept} onRename={onRename} /></strong>
        <span className={styles.subText}>{dept.code}</span>
      </div>

      <div className={styles.dataCardFields}>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Порядок</span>
          <SortOrderInput dept={dept} onChange={onSortOrder} />
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Норматив, дн</span>
          <NormDaysInput dept={dept} onChange={onNormDays} />
        </span>
      </div>

      <div className={styles.dataCardField}>
        <span className={styles.dataCardFieldLabel}>Руководитель</span>
        <HeadSelect dept={dept} candidates={headCandidates} onChange={onHead} />
      </div>

      <div className={styles.dataCardRow}>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Признаки</span>
          <DeptFlags
            dept={dept}
            onToggleProduction={onToggleProduction}
            onToggleBranding={onToggleBranding}
          />
        </span>
      </div>

      <div className={styles.dataCardRow}>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Ждёт материалы</span>
          <GateKinds dept={dept} onToggle={onToggleGateKind} />
        </span>
      </div>

      <div className={styles.dataCardRow}>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Отчёт участка</span>
          <ResultFieldsCell dept={dept} onSave={onSaveResultFields} />
        </span>
      </div>

      <Button variant="secondary" block onClick={onToggleActive}>
        {dept.active ? (
          <span className={styles.cellWithIcon}><Icon name="x" size={14} /> Отключить участок</span>
        ) : 'Вернуть участок'}
      </Button>
    </article>
  );
}

export const DeptCard = memo(DeptCardBase);
