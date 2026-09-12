import { useState } from 'react';
import { NumberStepper } from '../../components/NumberStepper';
import { SlideConfirm } from '../../../components/shared/SlideConfirm';
import { HOLD_MS, sweptSteps } from '../../utils/stepperSweep';
import { PULL_THRESHOLD } from '../../hooks/usePullToRefresh';
import { recolorKeepingLuminance } from '../../../styles/oklch';
import { contrastRatio } from '../../../styles/contrast';
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

/**
 * ПОДБОР ТОНА С СОХРАНЕНИЕМ ЯРКОСТИ (правило проекта, §4).
 *
 * Инструмент разработчика, а не орган управления продукта: живёт только
 * на витрине за флагом `styleguide`. Решает обратную задачу, которую до
 * 12.09 решали в голове, — и именно поэтому подбор «на глаз» один раз увёл
 * `--text-dim` на `--bg3` с 4.56 до 4.28, то есть ниже AA.
 *
 * ⚠️ ПОКАЗЫВАЕТ И ОТНОШЕНИЯ ТОЖЕ. Инструмент снимает с подбора произвол,
 * но сторожа не заменяет: порог 0.0012 по яркости даёт до 0.018 по отношению
 * (см. шапку `LUMA_EPS`), и пара, стоящая на 4.505, от такого уходит
 * под AA. Подобрали тон — прогоните `contrast.test.ts`.
 */
export function OklchDemo({ hue, chroma }) {
  const [hex, setHex] = useState('#6B7280');
  const valid = /^#[0-9a-fA-F]{6}$/.test(hex);
  const got = valid ? recolorKeepingLuminance(hex, hue, chroma || undefined) : null;
  const surfaces = ['#ffffff', '#eceae5', '#f5f4f1'];

  return (
    <div className={styles.sgStack}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Исходный цвет</span>
        <input
          className={`${styles.input} ${styles.inputSm}`}
          value={hex}
          onChange={(e) => setHex(e.target.value.trim())}
          aria-label="Исходный цвет в формате #rrggbb"
        />
      </label>

      {!valid && <span className={styles.subText}>Нужен формат #rrggbb</span>}

      {valid && !got && (
        <span className={styles.subText}>
          В оттенке {hue}° такой яркости в sRGB нет — уменьшите хрому.
          Это свойство охвата, а не ошибка: у насыщенного синего зелёного
          той же яркости и насыщенности не существует.
        </span>
      )}

      {valid && got && (
        <>
          <div className={styles.sgSwatchRow}>
            <span className={styles.sgToken}>было {hex}</span>
            {surfaces.map((bg) => (
              <span key={bg} className={styles.sgSwatch} style={{ background: bg, color: hex }}>
                Аа {contrastRatio(hex, bg).toFixed(2)}
              </span>
            ))}
          </div>
          <div className={styles.sgSwatchRow}>
            <span className={styles.sgToken}>стало {got.hex}</span>
            {surfaces.map((bg) => (
              <span key={bg} className={styles.sgSwatch} style={{ background: bg, color: got.hex }}>
                Аа {contrastRatio(got.hex, bg).toFixed(2)}
              </span>
            ))}
          </div>
          <span className={styles.subText}>
            OKLCH: L {got.oklch.l.toFixed(4)} · C {got.oklch.c.toFixed(4)} · H{' '}
            {Math.round(got.oklch.h)}°. Расхождение яркости{' '}
            {got.lumaError.toExponential(1)} — отношения выше обязаны совпасть
            в двух знаках. Не совпали — значит цель была на границе охвата.
          </span>
        </>
      )}
    </div>
  );
}
