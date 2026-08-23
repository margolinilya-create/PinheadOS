import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { Button } from '../../components/Button';
import { factoryToday } from '../../../utils/date';
import {
  dailyCapacity, monthCapacityReport, monthDates, monthLabel, workingDays,
} from '../../utils/capacity';
import { percentLabel } from '../../utils/format';
import styles from '../../styles';

/**
 * Мощность производства (правки заказчика 10.08, волна 2).
 *
 * Задаётся ОДНО число — сколько единиц продукции фабрика вытягивает за месяц.
 * Дневная и недельная мощность из него считаются, а не вводятся: в феврале
 * рабочих дней меньше, чем в марте, и фиксированное значение на день документ
 * запрещает прямо.
 *
 * Здесь же сразу видно, что настройка означает на практике: сколько это в день,
 * сколько работы уже набрано на текущий месяц и влезает ли она. Настройка,
 * последствия которой видны только на другом экране, правится вслепую.
 */
export function CapacityTab() {
  const { capacity, capacityLoaded, loadSettings, saveCapacity, orders } = useErpStore(
    useShallow((s) => ({
      capacity: s.capacity,
      capacityLoaded: s.capacityLoaded,
      loadSettings: s.loadSettings,
      saveCapacity: s.saveCapacity,
      orders: s.orders,
    })),
  );
  const access = useErpAccess();
  const canManage = access.can('plan.manage');
  const today = factoryToday();

  /**
   * Правки, а не копия настройки. Поле показывает сохранённое значение, пока
   * его не тронули; синхронизировать копию эффектом значило бы перерисовывать
   * форму на каждый приход стора — в том числе поверх набранного текста.
   */
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!capacityLoaded) loadSettings(); }, [capacityLoaded, loadSettings]);

  const units = edit?.units
    ?? (capacity.monthly_units === null ? '' : String(capacity.monthly_units));
  const perWeek = edit?.perWeek ?? String(capacity.work_days_per_week);
  const setUnits = (v) => setEdit({ units: v, perWeek });
  const setPerWeek = (v) => setEdit({ units, perWeek: v });

  /** Предпросмотр считается по ВВОДИМЫМ значениям, а не по сохранённым */
  const draft = useMemo(() => {
    const n = Number(units);
    return {
      monthly_units: Number.isFinite(n) && n > 0 ? Math.round(n) : null,
      work_days_per_week: Number(perWeek) || 5,
    };
  }, [units, perWeek]);

  const days = useMemo(() => monthDates(today), [today]);
  const workDays = workingDays(days, draft.work_days_per_week);
  const perDay = dailyCapacity(draft, today);
  const report = useMemo(
    () => monthCapacityReport(orders, today, draft),
    [orders, today, draft],
  );

  const dirty = capacityLoaded && (
    draft.monthly_units !== capacity.monthly_units
    || draft.work_days_per_week !== capacity.work_days_per_week
  );

  const submit = async () => {
    setBusy(true);
    const ok = await saveCapacity(draft);
    setBusy(false);
    // Сохранилось — правка больше не «своя»: поле возвращается к значению стора,
    // и кнопка гаснет сама, без сравнения двух копий одного числа
    if (ok) setEdit(null);
  };

  return (
    <div className={styles.matSection}>
      <p className={styles.queueReason}>
        Общая мощность фабрики в изделиях за месяц. Считается по изделиям, а не по
        этапам: одна футболка проходит закрой, нанесение, швейку и ВТО, и сумма по
        цехам дала бы вчетверо больше. Нормативы отдельных цехов задаются в разделе
        «Цеха» и с этим числом не складываются.
      </p>

      <div className={styles.planFormRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Единиц в месяц</span>
          <input
            className={styles.input}
            type="number"
            min="0"
            step="100"
            value={units}
            disabled={!canManage || !capacityLoaded}
            onChange={(e) => setUnits(e.target.value)}
            placeholder="напр. 10000"
          />
          <span className={styles.queueReason}>Пусто — мощность не задана, проценты загрузки не считаются.</span>
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Рабочих дней в неделе</span>
          <select
            value={perWeek}
            disabled={!canManage || !capacityLoaded}
            onChange={(e) => setPerWeek(e.target.value)}
          >
            <option value="5">5 — пн–пт</option>
            <option value="6">6 — пн–сб</option>
            <option value="7">7 — без выходных</option>
          </select>
          <span className={styles.queueReason}>
            Праздники не учитываются: календаря выходных в системе нет, а погрешность
            в день-два меньше погрешности самого плана.
          </span>
        </label>
      </div>

      <div className={styles.matSection}>
        <h3 className={styles.fieldLabel}>Что это значит для {monthLabel(today)}</h3>
        <ul className={styles.queueReason}>
          <li>рабочих дней в месяце: <b>{workDays}</b></li>
          <li>
            доступно в день:{' '}
            <b>{perDay === null ? '—' : Math.round(perDay)}</b> шт
          </li>
          <li>
            доступно за месяц:{' '}
            <b>{report.capacity === null ? '—' : report.capacity}</b> шт
          </li>
          <li>
            набрано заказов со сроком в этом месяце: <b>{report.used}</b> шт
            {report.orders > 0 && <span className={styles.subText}> ({report.orders} заказ.)</span>}
          </li>
          <li>
            загрузка: <b>{percentLabel(report.percent)}</b>
            {report.over > 0 && (
              <span className={styles.overdue}> · сверх мощности {report.over} шт</span>
            )}
            {report.capacity !== null && report.over === 0 && (
              <span className={styles.subText}> · свободно {report.left} шт</span>
            )}
          </li>
        </ul>
      </div>

      {canManage && (
        <Button variant="primary" disabled={busy || !dirty} onClick={submit}>
          {busy ? 'Сохраняем…' : 'Сохранить мощность'}
        </Button>
      )}
      {!canManage && (
        <p className={styles.subText}>
          Мощность правит тот, кто ведёт производственный план (право «Вести план»).
        </p>
      )}
    </div>
  );
}
