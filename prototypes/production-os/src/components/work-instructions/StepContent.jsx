import { ZONE_LABELS, TECH_NAMES } from '../../data/labels';
import styles from '../WorkInstructions.module.css';

function SizesGrid({ sizes }) {
  if (!sizes) return <div className={styles.empty}>Нет данных о размерах</div>;
  const entries = Object.entries(sizes);
  const total = entries.reduce((s, [, q]) => s + q, 0);
  return (
    <div className={styles.sizesWrap}>
      <div className={styles.sizesGrid}>
        {entries.map(([sz, qty]) => (
          <div key={sz} className={styles.sizeCell}>
            <div className={styles.sizeLabel}>{sz}</div>
            <div className={styles.sizeQty}>{qty}</div>
          </div>
        ))}
      </div>
      <div className={styles.sizesTotal}>Итого: {total} шт</div>
    </div>
  );
}

export default function StepContent({ content }) {
  if (!content) return null;

  switch (content.type) {
    case 'prep':
      return (
        <div className={styles.infoList}>
          <div className={styles.infoRow}><span className={styles.infoKey}>Изделие</span><span className={styles.infoVal}>{content.typeName}</span></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>Ткань</span><span className={styles.infoVal}>{content.fabricName}</span></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>Цвет</span><span className={styles.infoVal}>{content.colorName}</span></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>Количество</span><span className={`${styles.infoVal} ${styles.infoValBig}`}>{content.qty} шт</span></div>
        </div>
      );

    case 'zones':
      return (
        <div className={styles.zonesList}>
          {content.zones.length === 0 ? (
            <div className={styles.empty}>Нет зон для обработки</div>
          ) : (
            content.zones.map(z => {
              const tech = content.zoneTechs?.[z];
              return (
                <div key={z} className={styles.zoneCard}>
                  <div className={styles.zoneName}>{ZONE_LABELS[z] || z}</div>
                  <div className={styles.zoneTech}>{TECH_NAMES[tech] || tech || content.techName}</div>
                </div>
              );
            })
          )}
        </div>
      );

    case 'sizes':
      return <SizesGrid sizes={content.sizes} />;

    case 'notes':
      return (
        <div className={styles.notesWrap}>
          {content.handoffNote ? (
            <div className={`${styles.noteBlock} ${styles.noteBlockHandoff}`}>
              <div className={styles.noteLabel}>От предыдущего цеха:</div>
              <div className={styles.noteText}>{content.handoffNote}</div>
            </div>
          ) : (
            <div className={`${styles.noteBlock} ${styles.noteBlockEmpty}`}>
              <div className={`${styles.noteText} ${styles.noteTextDim}`}>Заметок от предыдущего цеха нет</div>
            </div>
          )}
          {content.orderNotes && (
            <div className={`${styles.noteBlock} ${styles.noteBlockOrder}`}>
              <div className={styles.noteLabel}>Примечание к заказу:</div>
              <div className={styles.noteText}>{content.orderNotes}</div>
            </div>
          )}
        </div>
      );

    case 'sewing_prep':
      return (
        <div className={styles.infoList}>
          <div className={styles.infoRow}><span className={styles.infoKey}>Ткань</span><span className={styles.infoVal}>{content.fabricName}</span></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>Крой</span><span className={styles.infoVal}>{content.fitName}</span></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>Цвет</span><span className={styles.infoVal}>{content.colorName}</span></div>
        </div>
      );

    case 'labels':
      return (
        <div className={styles.infoList}>
          {content.hasLabels ? (
            <div className={styles.noteBlock}>
              <div className={styles.noteText}>{content.labelInfo}</div>
            </div>
          ) : (
            <div className={`${styles.noteBlock} ${styles.noteBlockEmpty}`}>
              <div className={`${styles.noteText} ${styles.noteTextDim}`}>Специальных указаний по этикеткам нет — стандартный вариант</div>
            </div>
          )}
        </div>
      );

    case 'material':
      return (
        <div className={styles.infoList}>
          <div className={styles.infoRow}><span className={styles.infoKey}>Ткань</span><span className={styles.infoVal}>{content.fabricName}</span></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>Цвет</span><span className={styles.infoVal}>{content.colorName}</span></div>
        </div>
      );

    case 'order_info':
      return (
        <div className={styles.infoList}>
          <div className={styles.infoRow}><span className={styles.infoKey}>Клиент</span><span className={styles.infoVal}>{content.clientName}</span></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>Номер заказа</span><span className={`${styles.infoVal} ${styles.infoValBig}`}>{content.orderNumber}</span></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>Итого</span><span className={`${styles.infoVal} ${styles.infoValBig}`}>{content.qty} шт</span></div>
        </div>
      );

    case 'qc_checklist':
      return (
        <div className={styles.qcList}>
          {content.items.map((item, i) => (
            <div key={i} className={styles.qcItem}>
              <span className={styles.qcNum}>{i + 1}</span>
              <span className={styles.qcText}>{item}</span>
            </div>
          ))}
        </div>
      );

    case 'packaging':
      return (
        <div className={styles.infoList}>
          <div className={styles.infoRow}><span className={styles.infoKey}>Изделие</span><span className={styles.infoVal}>{content.typeName}</span></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>Цвет</span><span className={styles.infoVal}>{content.colorName}</span></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>Количество</span><span className={`${styles.infoVal} ${styles.infoValBig}`}>{content.qty} шт</span></div>
          <div className={styles.noteBlock}>
            <div className={styles.noteText}>Упаковать в полиэтиленовые пакеты, сложить по размерам. Приложить накладную.</div>
          </div>
        </div>
      );

    case 'embroidery_prep':
      return (
        <div className={styles.infoList}>
          <div className={styles.infoRow}><span className={styles.infoKey}>Ткань</span><span className={styles.infoVal}>{content.fabricName}</span></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>Цвет</span><span className={styles.infoVal}>{content.colorName}</span></div>
          {content.zones.length > 0 && (
            <div className={styles.zonesList} style={{ marginTop: 16 }}>
              {content.zones.map(z => (
                <div key={z} className={styles.zoneCard}>
                  <div className={styles.zoneName}>{ZONE_LABELS[z] || z}</div>
                  <div className={styles.zoneTech}>Вышивка</div>
                </div>
              ))}
            </div>
          )}
        </div>
      );

    default:
      return null;
  }
}
