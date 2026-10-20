import { pluralize } from '../../../utils/i18n';
import { avgText, materialLabel, metres } from './useCutReport';
import css from './CutTotalsBar.module.css';

/**
 * ЛИПКАЯ ПОЛОСА ИТОГОВ ЗАКРОЯ (правки 19.10): по каждому материалу —
 * «Расход · Остаток · Средний», рядом «Сдать результат».
 *
 * Регион `role="status"` ОДИН на форму: в нём и итоги, и объявление
 * массового действия («2 рулона: полностью. Расход 100 м»). Числа — снимок
 * (`cut.barTotals`): обновляется по `blur` и смене режима, иначе читалка
 * зачитывала бы каждую нажатую цифру. Ошибки сдачи — отдельным `alert`.
 */
export function CutTotalsBar({ cut, options, children = null }) {
  const labels = new Map(options.map((o) => [o.material.id, materialLabel(o.material)]));
  const alert = cut.attempted && cut.errorCount > 0
    ? `Проверьте ${cut.errorCount} ${pluralize(cut.errorCount, 'рулон', 'рулона', 'рулонов')}` : '';
  return (
    <div className={css.bar}>
      <div className={css.status} role="status">
        {cut.message && <p className={css.message}>{cut.message}</p>}
        {cut.barTotals.map((t) => (
          <p key={t.materialId} className={css.line}>
            {labels.get(t.materialId) ?? 'Материал'}: Расход {metres(t.totalM)} · Остаток {metres(t.usableLeftM)}
            {' '}· {avgText(t)}
          </p>
        ))}
      </div>
      {alert && <p className={css.alert} role="alert">{alert}</p>}
      {children && <div className={css.actions}>{children}</div>}
    </div>
  );
}
