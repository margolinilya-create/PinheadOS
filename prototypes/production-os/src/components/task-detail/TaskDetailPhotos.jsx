import useWorkshopStore from '../../store/useWorkshopStore';
import styles from '../TaskDetail.module.css';

export default function TaskDetailPhotos({ taskId }) {
  const photos = useWorkshopStore(s => s.photos[taskId] || []);
  const addPhoto = useWorkshopStore(s => s.addPhoto);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      addPhoto(taskId, reader.result, file.name);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>Фото {photos.length > 0 && `(${photos.length})`}</div>
      {photos.length > 0 && (
        <div className={styles.photos}>
          {photos.map(p => (
            <div key={p.id} className={styles.photoItem}>
              <img src={p.dataUrl} alt={p.caption} className={styles.photoImg} />
              {p.caption && <span className={styles.photoCaption}>{p.caption}</span>}
            </div>
          ))}
        </div>
      )}
      <label className={styles.photoUploadBtn}>
        📷 Добавить фото
        <input type="file" accept="image/*" onChange={handleFileChange} hidden />
      </label>
    </div>
  );
}
