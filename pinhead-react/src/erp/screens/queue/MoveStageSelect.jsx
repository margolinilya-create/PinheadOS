import { useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { deptShortName } from '../../data/departments';
import styles from '../../styles';

/**
 * ПЕРЕНОС В ДРУГОЙ ЦЕХ ИЗ ПАНЕЛИ ДЕЙСТВИЙ (§2.5 обхода 04.09). Раньше
 * `moveStageToDepartment` звал только канбан, а вид доски по умолчанию —
 * таблица: диспетчер, увидевший затор в очереди участка, обязан был уйти
 * на доску и переключить вид. Логика та же самая (`hooks/useStageMove`) —
 * подтверждение с последствиями и обязательная причина при возврате назад;
 * второй реализации нет. Вынесено из `StageActionsPanel` 27.09 (потолок
 * ратчета размера).
 */
export function MoveStageSelect({ entry, targets, busy, run, moveStageTo }) {
  const [moveTo, setMoveTo] = useState('');
  return (
    <span className={styles.checkRow}>
      <select
        className={styles.select}
        value={moveTo}
        onChange={(e) => setMoveTo(e.target.value)}
        aria-label="Перенести задание в другой цех"
      >
        <option value="">— перенести в цех —</option>
        {targets.map((d) => (
          <option key={d.id} value={d.id}>{deptShortName(d.code, d.name)}</option>
        ))}
      </select>
      <Button
        variant="ghost"
        loading={busy}
        disabled={busy || !moveTo}
        onClick={() => run(async () => {
          const dept = targets.find((d) => d.id === moveTo);
          if (dept) await moveStageTo(entry, dept);
          setMoveTo('');
        })}
      >
        <Icon name="arrowRight" size={14} /> Перенести
      </Button>
    </span>
  );
}
