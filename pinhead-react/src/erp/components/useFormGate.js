import { useCallback, useMemo, useState } from 'react';
import styles from '../erp.module.css';

/**
 * Единый паттерн валидации форм ERP.
 *
 * ПОЧЕМУ (находка H-16, QA 13.08.2026). Одно и то же действие — «сохранить
 * с незаполненным обязательным полем» — вело себя в продукте ТРЕМЯ способами:
 *
 *   «Новый заказ»      — подсветка поля, сообщение под ним, строка «Осталось
 *                        заполнить: …», автоскролл к первой ошибке;
 *   «Новая закупка»,
 *   «+ Разработка»     — красный тост в углу экрана, далеко от поля и вне модалки;
 *   «Записать приёмку» — ПОЛНАЯ ТИШИНА: кнопка блокировалась сразу, без единого
 *                        слова о том, чего не хватает. Кладовщик жал кнопку
 *                        и не понимал, сломалось или не сохранилось.
 *
 * Третий случай — не «забыли валидацию», а её худшая форма: `disabled` без
 * объяснения неотличим от неработающей кнопки. Поэтому кнопка остаётся живой
 * до первой попытки, а после неё показывает, что именно не так.
 *
 * Эталон — форма «Новый заказ», и здесь ровно её механика, вынесенная так,
 * чтобы остальные формы не переписывали её заново (и не расходились в четвёртый
 * раз). `validateOrderForm` сама формы не строит: у неё своя сложная доменная
 * проверка позиций, и она отдаёт тот же `{ errors, missing, invalid }`.
 *
 * Правило: `missing` — «не заполнено», `invalid` — «заполнено, но неверно».
 * Смешивать нельзя, иначе при заполненной дате всплывает «Осталось заполнить:
 * Дата запуска».
 *
 * @param {Array<{key: string, label: string, ok: boolean, kind?: 'missing'|'invalid', message?: string}>} rules
 */
export function useFormGate(rules) {
  const [submitted, setSubmitted] = useState(false);

  const state = useMemo(() => {
    const failed = rules.filter((r) => r && !r.ok);
    return {
      failed,
      ok: failed.length === 0,
      missing: failed.filter((r) => (r.kind || 'missing') === 'missing').map((r) => r.label),
      invalid: failed.filter((r) => r.kind === 'invalid').map((r) => r.label),
    };
  }, [rules]);

  const bad = useCallback(
    (key) => submitted && state.failed.some((r) => r.key === key),
    [submitted, state.failed],
  );

  const errId = useCallback((key) => `fg-err-${key}`, []);

  /** Текст под полем. По умолчанию — из подписи, чтобы не писать его дважды */
  const error = useCallback((key) => {
    if (!bad(key)) return null;
    const rule = state.failed.find((r) => r.key === key);
    if (rule.message) return rule.message;
    return rule.kind === 'invalid' ? `Проверьте: ${rule.label}` : `Заполните: ${rule.label}`;
  }, [bad, state.failed]);

  /** Атрибуты поля: доступность + якорь для автоскролла */
  const field = useCallback((key) => (bad(key)
    ? { 'aria-invalid': true, 'aria-describedby': errId(key), 'data-invalid': true }
    : {}), [bad, errId]);

  /** Класс поля с рамкой ошибки */
  const cls = useCallback(
    (base, key) => (bad(key) ? `${base} ${styles.inputError}` : base),
    [bad],
  );

  /**
   * Обёртка сабмита. Не пускает дальше и переводит фокус на первое ошибочное
   * поле: сообщение под полем бесполезно, если поле осталось за краем экрана.
   */
  const guard = useCallback((run) => (...args) => {
    setSubmitted(true);
    if (!state.ok) {
      requestAnimationFrame(() => {
        const el = document.querySelector('[data-invalid="true"]');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof el?.focus === 'function') el.focus({ preventScroll: true });
      });
      return undefined;
    }
    return run(...args);
  }, [state.ok]);

  const reset = useCallback(() => setSubmitted(false), []);

  return { submitted, ok: state.ok, missing: state.missing, invalid: state.invalid, field, cls, error, errId, guard, reset };
}
