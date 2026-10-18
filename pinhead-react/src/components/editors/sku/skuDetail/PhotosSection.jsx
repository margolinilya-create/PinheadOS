import { useEffect, useMemo, useRef, useState } from 'react';
import { uploadSkuPhoto, deleteSkuPhotoByUrl } from '../../../../lib/storage';
import { toast } from '../../../../store/useToastStore';
import { mockupSrc } from '../../../steps/garment/garmentMockup';
import { Button } from '../../../../erp/components/Button';
import { Icon } from '../../../../erp/components/Icon';
import m from '../SkuModal.module.css';

export const MAX_PHOTOS = 4;

/**
 * Фото модели (до четырёх, бакет `sku-photos`): предпросмотр → «Загрузить»,
 * главное — первое, удаление проверяет ответ хранилища. После каждой правки —
 * `onPersist` (сохранение каталога), иначе фото не переживёт обновления страницы.
 */
export default function PhotosSection({ sku, skuIndex, onUpdate, onPersist }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null); // { file, objectUrl }

  const photos = useMemo(() => sku.photos || [], [sku.photos]);
  const photosRef = useRef(photos);
  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => () => { if (preview?.objectUrl) URL.revokeObjectURL(preview.objectUrl); }, [preview]);

  const pick = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (photosRef.current.length >= MAX_PHOTOS) {
      toast.error(`Максимум ${MAX_PHOTOS} фото`);
      return;
    }
    setPreview({ file, objectUrl: URL.createObjectURL(file) });
  };

  const confirmUpload = async () => {
    if (!preview) return;
    URL.revokeObjectURL(preview.objectUrl);
    const { file } = preview;
    setPreview(null);
    setUploading(true);
    const url = await uploadSkuPhoto(sku.code, file, photosRef.current.length);
    setUploading(false);
    if (!url) { toast.error('Ошибка загрузки фото'); return; }
    const next = [...photosRef.current, url];
    photosRef.current = next;
    onUpdate(skuIndex, 'photos', next);
    await onPersist?.();
    toast.success('Фото сохранено');
  };

  const cancelPreview = () => {
    if (!preview) return;
    URL.revokeObjectURL(preview.objectUrl);
    setPreview(null);
  };

  const setMain = async (idx) => {
    if (idx === 0) return;
    const next = [photos[idx], ...photos.filter((_, i) => i !== idx)];
    photosRef.current = next;
    onUpdate(skuIndex, 'photos', next);
    await onPersist?.();
  };

  const remove = async (idx) => {
    const ok = await deleteSkuPhotoByUrl(photos[idx]);
    if (!ok) toast.error('Не удалось удалить фото из хранилища');
    onUpdate(skuIndex, 'photos', photos.filter((_, i) => i !== idx));
    await onPersist?.();
    if (ok) toast.success('Фото удалено');
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) pick(file);
  };

  const mockup = photos.length === 0 ? mockupSrc(sku.mockupType, '#d9d9d9') : '';

  return (
    <section className={m.section} aria-labelledby="sku-detail-photos">
      <h3 id="sku-detail-photos" className={m.sectionHead}>Фото модели ({photos.length} из {MAX_PHOTOS})</h3>
      <div className={m.photos}>
        {photos.map((url, i) => (
          <div key={url} className={`${m.photo} ${i === 0 ? m.photoMain : ''}`}>
            <button type="button" className={m.photoImg} onClick={() => setMain(i)} disabled={i === 0}
              aria-label={i === 0 ? `Фото ${i + 1} — главное` : `Сделать фото ${i + 1} главным`}>
              <img src={url} alt="" />
            </button>
            <div className={m.photoTools}>
              <Button iconOnly icon="trash" aria-label={`Удалить фото ${i + 1}`} onClick={() => remove(i)} />
            </div>
            {i === 0 && <span className={m.photoBadge}>Главное</span>}
          </div>
        ))}
        {preview && (
          <div className={m.photo}>
            <img className={m.photoImg} src={preview.objectUrl} alt="Предпросмотр нового фото" />
            <div className={m.photoTools}>
              <Button variant="primary" iconOnly icon="check" aria-label="Загрузить фото" onClick={confirmUpload} />
              <Button iconOnly icon="x" aria-label="Отменить загрузку" onClick={cancelPreview} />
            </div>
          </div>
        )}
        {!preview && photos.length < MAX_PHOTOS && (
          <button
            type="button"
            className={`${m.upload} ${dragOver ? m.uploadOver : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Загрузка…' : (
              <>
                {mockup ? <img className={m.mockup} src={mockup} alt="" /> : <Icon name="plus" size={24} />}
                <span>Добавить фото</span>
              </>
            )}
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden aria-label="Файл фото модели"
        onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
    </section>
  );
}
