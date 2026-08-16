import { supabase } from '../../lib/supabase';
import { Icon } from './Icon';
import styles from '../erp.module.css';

/**
 * Приложенные файлы блока — на чтение (правки заказчика 16.08).
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ. Файлы упаковки, техблока и листа закупки заказчик просит
 * не «чтобы были»: их адресат — цех и закупщик. Схема узла, расположение бирки
 * и стикера, фото материала и скрин позиции поставщика словами не передаются,
 * и если их некому показать, загрузка бессмысленна.
 *
 * Картинка показывается миниатюрой, остальное — ссылкой с именем. Имя берётся
 * из `file_name`: в ключе объекта оно транслитерировано (Storage не принимает
 * кириллицу), и «shema_uzla.jpg» человек своим файлом не опознает.
 */

const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif)$/i;

function publicUrl(path) {
  return supabase.storage.from('erp-attachments').getPublicUrl(path).data.publicUrl;
}

export function AttachmentList({ files, label }) {
  if (!files || files.length === 0) return null;
  return (
    <div className={styles.attachBlock}>
      {label && <div className={styles.fieldLabel}>{label}</div>}
      <div className={styles.attachThumbs}>
        {files.map((f) => {
          const url = publicUrl(f.file_path);
          const name = f.file_name || 'файл';
          return IMAGE_RE.test(name) || IMAGE_RE.test(f.file_path) ? (
            <a
              key={f.id}
              href={url}
              target="_blank"
              rel="noreferrer"
              className={styles.attachThumb}
              title={name}
            >
              <img src={url} alt={name} loading="lazy" />
            </a>
          ) : (
            <a
              key={f.id}
              href={url}
              target="_blank"
              rel="noreferrer"
              className={styles.attachRow}
              title={name}
            >
              <Icon name="file" size={13} />
              <span className={styles.attachName}>{name}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
