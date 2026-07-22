import styles from '../erp.module.css';

/**
 * Единый статус-бейдж (редизайн, по UI Kit). Пилюля с тонированным фоном по палитре.
 * Варианты соответствуют дизайн-системе; строится на токен-классах .chip* (erp.module.css).
 */

const VARIANT_CLASS = {
  waiting: 'chipWaiting',   // амбер — ожидает
  progress: 'chipProgress', // синий — в работе
  info: 'chipInfo',         // синий
  ready: 'chipReady',       // зелёный — готово/принято
  done: 'chipDone',         // зелёный
  blocked: 'chipBlocked',   // красный — просрочено/проблема
  danger: 'chipDanger',     // красный
  neutral: 'chipNeutral',   // серый — запланировано
  skipped: 'chipSkipped',   // зачёркнуто
  violet: 'chipViolet',     // фиолетовый — тип «кастомный»
  cyan: 'chipCyan',         // бирюзовый — тип «образец»
};

export function Badge({ variant = 'neutral', children, className = '', ...rest }) {
  const variantClass = styles[VARIANT_CLASS[variant] || 'chipNeutral'];
  return (
    <span className={`${styles.chip} ${variantClass} ${className}`.trim()} {...rest}>
      {children}
    </span>
  );
}
