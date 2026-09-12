import { useState } from 'react';
import { NumberStepper } from '../../components/NumberStepper';
import { SlideConfirm } from '../../../components/shared/SlideConfirm';
import { HOLD_MS, sweptSteps } from '../../utils/stepperSweep';
import { PULL_THRESHOLD } from '../../hooks/usePullToRefresh';
import styles from '../../styles';

/**
 * Живые демонстрации механизмов витрины. ТОЛЬКО компоненты — каталог с их
 * параметрами лежит в `mechanisms.js` рядом.
 *
 * Разделение не косметическое: `react-refresh/only-export-components`
 * запрещает файлу экспортировать компоненты вместе с чем-то ещё, и в проекте
 * это уже разведено так же (`purchasing/purchaseLabels` отдельно от колонок
 * закупки, `hasLegacySubcontracts` отдельно от своей вкладки).
 *
 * Каждая демонстрация держит СВОЁ состояние (введённое число, счёт
 * подтверждений) — ручки приезжают пропами, данные живут здесь.
 */
export function StepperDemo({ step, max, unit }) {
  const [value, setValue] = useState('3');
  return (
    <div className={styles.sgStack}>
      <NumberStepper
        value={value}
        onChange={setValue}
        min={0}
        max={max}
        step={step}
        unit={unit === '—' ? undefined : unit}
        ariaLabel="Демонстрация числового поля"
      />
      <span className={styles.subText}>
        Тап по ± — один шаг. Удержание дольше {HOLD_MS} мс включает свип:
        за первую секунду набегает {sweptSteps(1000)} шагов, за две —{' '}
        {sweptSteps(2000)}. Значение: <b>{value || '—'}</b>
      </span>
    </div>
  );
}

export function SlideConfirmDemo({ label }) {
  const [done, setDone] = useState(0);
  return (
    <div className={styles.sgStack}>
      <SlideConfirm label={label} onCommit={() => setDone((n) => n + 1)} />
      <span className={styles.subText}>
        {done > 0
          ? `Подтверждено раз: ${done}. Коммит происходит НА ПОРОГЕ, отпускать не нужно.`
          : 'Протяните до конца — или нажмите Enter, когда трек в фокусе.'}
      </span>
    </div>
  );
}

export function PullToRefreshDemo() {
  return (
    <div className={styles.sgStack}>
      <span className={styles.subText}>
        Жест живёт в оболочке и только на тач-вводе (`pointer: coarse`),
        поэтому показать его здесь мышью нельзя — он бы и не сработал.
        Порог — {PULL_THRESHOLD} px полосы после сопротивления; обновление
        идёт существующим `resyncRealtime`, а состояние называет полоса
        сверху: «Потяните» → «Отпустите, чтобы обновить» → «Обновляем…».
      </span>
      <span className={styles.subText}>
        Проверять на планшете: очередь цеха, доска, склад. На доске жест
        разведён с перетаскиванием карточек тремя признаками — см.
        `hooks/usePullToRefresh`.
      </span>
    </div>
  );
}
