import { useFocusTrap } from '../../hooks/useFocusTrap';
import styles from '../erp.module.css';

/**
 * Правая боковая панель деталей (редизайн). Монтируется родителем только когда открыта
 * (`{open && <Drawer.../>}`). Escape и фокус-трап — в `useFocusTrap` (кнопка «Закрыть» всегда
 * фокусируется первой, фокус заперт внутри). Опциональные вкладки (`tabs` + `activeTab`/`onTab`).
 * Оверлей закрывает по клику, панель — стоп-пропагация.
 */
export function Drawer({ onClose, title, subtitle, badge, tabs, activeTab, onTab, children }) {
  const panelRef = useFocusTrap(true, onClose);

  return (
    <div className={styles.drawerOverlay} onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className={styles.drawerPanel}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Детали'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.drawerHead}>
          <div className={styles.drawerHeadMain}>
            {badge}
            <div className={styles.drawerTitle}>{title}</div>
            {subtitle && <div className={styles.subText}>{subtitle}</div>}
          </div>
          <button type="button" className={styles.drawerClose} onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        {tabs && tabs.length > 0 && (
          <div className={styles.drawerTabs} role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key} type="button" role="tab" aria-selected={activeTab === t.key}
                className={`${styles.drawerTab} ${activeTab === t.key ? styles.drawerTabActive : ''}`}
                onClick={() => onTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className={styles.drawerBody}>{children}</div>
      </div>
    </div>
  );
}
