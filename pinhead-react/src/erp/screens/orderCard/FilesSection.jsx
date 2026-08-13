import { useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/Button';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import styles from '../../erp.module.css';

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
 *
 * ЗАГРУЗКА (M-22 отчёта QA 13.08.2026). Вкладка была тупиком: заголовок,
 * «Файлов нет» и всё — ни кнопки, ни зоны перетаскивания. При этом действие
 * `uploadOrderAttachment` в сторе есть с самого начала и работает: им
 * пользуется цех, прикрепляя фото к заданию. То есть раздел выглядел
 * незаконченным, будучи готовым — не хватало одной кнопки.
 *
 * Право — `order.manage`: файл заказа это его содержимое, и правит его тот же,
 * кто правит сам заказ. Без права раздел остаётся на чтение, как и всё
 * остальное в карточке.
 */
export function FilesSection({ attachments, orderId }) {
  const list = attachments ?? [];
  const uploadOrderAttachment = useErpStore((s) => s.uploadOrderAttachment);
  const canManage = useErpAccess().can('order.manage');
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file) => {
    if (!file || !orderId) return;
    setBusy(true);
    await uploadOrderAttachment(orderId, file, null);
    setBusy(false);
  };

  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <strong>Файлы</strong>
        {canManage && orderId && (
          <>
            <Button
              variant="secondary"
              icon="paperclip"
              loading={busy}
              onClick={() => inputRef.current?.click()}
            >
              Прикрепить файл
            </Button>
            <input
              ref={inputRef}
              type="file"
              className={styles.visuallyHidden}
              aria-label="Прикрепить файл к заказу"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                pick(file);
              }}
            />
          </>
        )}
      </div>
      {list.length === 0 ? (
        <div className={styles.subText}>
          {canManage
            ? 'Файлов нет — прикрепите первый кнопкой выше.'
            : 'Файлов нет.'}
        </div>
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
