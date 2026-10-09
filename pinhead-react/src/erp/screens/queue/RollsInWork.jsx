import { useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { rollLeftText } from '../../utils/cutRolls';
import { RollFinishModal } from './RollFinishModal';
import styles from '../../styles';

/**
 * «РУЛОНЫ В РАБОТЕ» С КНОПКОЙ «ЗАВЕРШИТЬ РУЛОН» (правка 05.10, п. 5).
 *
 * С 09.10 (обход QA) блок стоит и на экране задания, а не только в форме
 * «Записать результат»: отказ «Завершить этап» велит нажать «Завершить
 * рулон», и искать кнопку внутри другой формы человек не обязан.
 */
export function RollsInWork({ inWork, awaitingCount, itemId = null, onFinishRoll, disabled = false }) {
  const [finishing, setFinishing] = useState(null);
  if (inWork.length === 0 || !onFinishRoll) return null;
  return (
    <>
      <div className={styles.queueBlockForm} role="group" aria-label="Рулоны в работе">
        <span className={styles.queueReason}>
          {awaitingCount > 0 && <><Icon name="alert" size={13} />{' '}</>}
          Рулоны в работе
          {awaitingCount > 0 ? ' — без решения по остатку этап не закроется' : ''}:
        </span>
        {inWork.map((o) => (
          <div key={o.roll.id} className={styles.queueActions}>
            <span className={styles.subText}>
              {o.label} · остаток {rollLeftText(o.roll, o.material)}
            </span>
            <Button variant="secondary" size="sm" disabled={disabled} onClick={() => setFinishing(o)}>
              Завершить рулон
            </Button>
          </div>
        ))}
      </div>
      {finishing && (
        <RollFinishModal
          option={finishing}
          itemId={itemId}
          onFinish={onFinishRoll}
          onClose={() => setFinishing(null)}
        />
      )}
    </>
  );
}
