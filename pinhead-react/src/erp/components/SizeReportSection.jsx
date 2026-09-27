import { SizeResultTable } from './SizeResultTable';
import { rowEntered } from '../utils/stageSizes';
import styles from '../erp.module.css';

/**
 * Размерная таблица сдачи результата (швейка и другие участки
 * с `result_detail = 'sizes'`): «Покроено» подтянуто из закроя, «Сшито /
 * Брак / В переделку» вводит мастер, «Статус» считается.
 *
 * Вынесено из `StageReportForm` 27.09 (правка 6): форма стоит на потолке
 * ратчета размера, а таблица — самостоятельный кусок со своей логикой
 * колонок. Данные строк (`rows`) по-прежнему считает форма — здесь только
 * показ и подсветка.
 */
export function SizeReportSection({ rows, values, onChange, canDefect, disabled }) {
  return (
    <>
      <span className={styles.fieldLabel}>Размерная разбивка</span>
      <SizeResultTable
        rows={rows.map((r) => ({ ...r, expected: r.expected ?? '—' }))}
        columns={[
          {
            code: 'good',
            label: 'Сшито, шт',
            /* Подсветка ИМЕННО этого поля: документ просит показать,
               какую строку исправлять, а не «где-то превышение» */
            invalid: (row, vals) => row.expected !== null
              && row.expected !== '—'
              && rowEntered(vals) > Number(row.expected),
          },
          ...(canDefect ? [
            { code: 'defect', label: 'Брак, шт' },
            { code: 'rework', label: 'В переделку, шт' },
          ] : []),
          {
            code: 'state',
            label: 'Статус',
            /* Колонка-ВЫВОД: считается, а не вводится. Мастер видит
               состояние строки, не сверяя два числа глазами */
            render: (row, vals) => {
              if (row.expected === null || row.expected === '—') {
                return <span className={styles.subText}>—</span>;
              }
              const entered = rowEntered(vals);
              if (entered === 0) return <span className={styles.subText}>не заполнено</span>;
              if (entered > Number(row.expected)) {
                return (
                  <span className={styles.cellError}>
                    Нельзя указать больше, чем покроено
                  </span>
                );
              }
              const left = Number(row.expected) - entered;
              return left > 0
                ? <span className={styles.subText}>осталось {left}</span>
                : <span className={styles.subText}>готово</span>;
            },
          },
        ]}
        values={values}
        onChange={onChange}
        expectedLabel="Покроено, шт"
        caption="Результат пошива по размерам"
        disabled={disabled}
      />
    </>
  );
}
