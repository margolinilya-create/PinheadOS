import styles from './DesignTab.module.css';

/**
 * Плашки силуэта над холстом (веха 5б, задача 5; К15, Р12) — вынесены из
 * `DesignTab`, чтобы вкладка не росла:
 *
 * - модель сменилась — перенести на подходящий силуэт (5а);
 * - **силуэт обновлён:** нанесения стоят по прежней версии — «Перенести на
 *   версию M» (`d.transferVersion`). Открытие ничего не пишет; кнопка — только
 *   в черновике, иначе плашка без кнопки (холст рисует по версии нанесений);
 * - **точный силуэт:** у позиции типовой, а для модели появился точный —
 *   «Перенести нанесения» (`d.switchFlat`, подтверждение и `remapToFlat`);
 * - силуэт типовой — подсказка; итог последнего переноса — `role="status"`.
 */
export default function FlatNotices({ d, readOnly }) {
  const { pick, flat, itemFlat } = d;
  if (!flat) return null;
  const current = itemFlat.current;
  const version = itemFlat.version;
  const upgrade = itemFlat.upgrade;
  return (
    <>
      {pick.modelChanged && (
        <p className={`${styles.notice} ${styles.warn}`}>
          {pick.suggested
            ? `Силуэт «${flat.name}» — от другой модели. Перенесите нанесения на силуэт этой модели.`
            : `Силуэт «${flat.name}» — от другой модели, а своего силуэта у модели нет. Снимите нанесения с изделия — они останутся строками на «Изделии».`}
          {pick.suggested && !readOnly && (
            <button type="button" className={styles.btn} onClick={() => d.switchFlat(pick.suggested)}>
              Перенести на «{pick.suggested.name}»
            </button>
          )}
        </p>
      )}
      {itemFlat.outdated && current && (
        <p className={`${styles.notice} ${styles.warn}`}>
          {version && !version.mixed && version.known
            ? `Силуэт обновлён до версии ${current.version}. Нанесения стоят по версии ${version.version}.`
            : `Силуэт обновлён до версии ${current.version}. Часть нанесений стоит по прежним версиям — положение примерное.`}
          {!readOnly && (
            <button type="button" className={styles.btn} onClick={d.transferVersion}>
              Перенести на версию {current.version}
            </button>
          )}
        </p>
      )}
      {upgrade && (
        <p className={styles.notice}>
          Для модели появился точный силуэт «{upgrade.name}».
          {!readOnly && (
            <button type="button" className={styles.btn} onClick={() => d.switchFlat(upgrade)}>
              Перенести нанесения
            </button>
          )}
        </p>
      )}
      {flat.typical && <p className={styles.muted}>Силуэт типовой, не лекало модели: размеры и отступы — ориентир для цеха.</p>}
      {d.switchNote && <p className={styles.notice} role="status">{d.switchNote}</p>}
    </>
  );
}
