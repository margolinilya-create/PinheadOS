import { useFocusTrap } from '../../hooks/useFocusTrap';
import styles from '../erp.module.css';
import { Icon } from './Icon';

/**
 * Правая боковая панель деталей (редизайн). Монтируется родителем только когда открыта
 * (`{open && <Drawer.../>}`). Escape и фокус-трап — в `useFocusTrap` (кнопка «Закрыть» всегда
 * фокусируется первой, фокус заперт внутри). Оверлей закрывает по клику,
 * панель — стоп-пропагация.
 *
 * ВКЛАДОК ЗДЕСЬ БОЛЬШЕ НЕТ (05.09). Ветка `tabs`/`activeTab`/`onTab` несла
 * полный таб-паттерн и не вызывалась НИ ОДНИМ из трёх вызывающих
 * (`DefectWizard`, `DevToSku`, шторка склада) — она осталась от боковой
 * карточки заказа, убранной 16.08. Её собственный `aria-label` это и выдавал:
 * «Разделы карточки заказа» в панели, которая заказ уже не показывает.
 * Тот же жанр, что осиротевший вид `pipeline` у `StageIndicator`: удаляя
 * экран, проверьте, не остался ли без вызывающих примитив, который звал он.
 * Вкладки страницы — `components/Tabs`.
 *
 * ШИРОКАЯ ПАНЕЛЬ И ЗАКРЕПЛЁННЫЙ НИЗ (правка 05.10, пп. 4 и 8): `wide` —
 * для форм с таблицей (приёмка рулонов, карточка закупки), где 560px
 * разбивали строку рулона на две. Итог и сохранение закрепляет сам
 * вызывающий классом `drawerFooter` внутри тела: состояние формы живёт
 * в нём, и пробрасывать его наверх ради слота незачем.
 */
export function Drawer({ onClose, title, subtitle, badge, wide = false, children }) {
  const panelRef = useFocusTrap(true, onClose);

  return (
    <div className={styles.drawerOverlay} onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className={`${styles.drawerPanel} ${wide ? styles.drawerPanelWide : ''}`}
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
          <button type="button" className={styles.drawerClose} onClick={onClose} aria-label="Закрыть"><Icon name="x" size={16} /></button>
        </div>
        <div className={styles.drawerBody}>
          {children}
        </div>
      </div>
    </div>
  );
}
