import { supabase } from '../../../lib/supabase';
import { Icon } from '../../components/Icon';
import styles from '../../styles';

const ATTACH_KIND_LABEL = { preview: 'Превью', attachment: 'Вложение' };

/** Публичный URL файла заказа в бакете erp-attachments */
function attachmentUrl(path) {
  return supabase.storage.from('erp-attachments').getPublicUrl(path).data.publicUrl;
}

/**
 * Вложения заказа — общая секция боковой карточки и полной страницы.
 *
 * Раньше жила только в Drawer, поэтому по прямой ссылке `/orders/:id` — той самой,
 * которую шлют коллегам, — файлов заказа не было видно вовсе.
 */
export function FilesSection({ attachments }) {
  const list = attachments ?? [];
  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}><strong>Файлы</strong></div>
      {list.length === 0 ? (
        <div className={styles.subText}>Файлов нет.</div>
      ) : (
        <div className={styles.fileGrid}>
          {list.map((a) => {
            const url = attachmentUrl(a.file_path);
            // Не всякое вложение — картинка: у PDF и прочих рисуем иконку,
            // иначе браузер показывал бы битый <img>
            const isImage = /\.(png|jpe?g|webp|gif|avif)$/i.test(a.file_name || a.file_path);
            return (
              <a key={a.id} href={url} target="_blank" rel="noreferrer" className={styles.fileCard}>
                {isImage ? (
                  <img
                    src={url} alt={a.file_name || 'файл'} className={styles.fileThumb} loading="lazy"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  <span className={styles.fileThumbStub} aria-hidden="true">
                    <Icon name="orders" size={28} />
                  </span>
                )}
                <span className={styles.fileName}>
                  {ATTACH_KIND_LABEL[a.kind] ? `${ATTACH_KIND_LABEL[a.kind]} · ` : ''}
                  {a.file_name || 'файл'}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
