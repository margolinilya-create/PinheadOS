import { useState, useEffect, useRef } from 'react';
import { useOrdersStore, STATUS_LIST, STATUS_LABELS, STATUS_COLORS } from '../../store/useOrdersStore';
import { useAuthStore } from '../../store/useAuthStore';
import { TYPE_NAMES, FABRIC_NAMES, ZONE_LABELS, TECH_NAMES, SIZES } from '../../data';
import { toast } from '../shared/Toast';
import QRCode from 'qrcode';

const CHECKLIST_ITEMS = [
  { key: 'cut', label: 'Раскрой' },
  { key: 'sew', label: 'Пошив' },
  { key: 'print', label: 'Нанесение' },
  { key: 'labels', label: 'Бирки' },
  { key: 'pack', label: 'Упаковка' },
  { key: 'qc', label: 'Контроль качества' },
];

export default function TechCard({ order, onClose, onStatusChange }) {
  const updateOrder = useOrdersStore(s => s.updateOrder);
  const user = useAuthStore(s => s.user);
  const d = order.data || {};

  // Local state for checklist, comments, photos
  const [checklist, setChecklist] = useState(d.checklist || {});
  const [comments, setComments] = useState(d.comments || []);
  const [photos, setPhotos] = useState(d.photos || []);
  const [commentText, setCommentText] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const fileRef = useRef(null);

  // Generate QR code
  useEffect(() => {
    const url = `${window.location.origin}/#order/${order.order_number}`;
    QRCode.toDataURL(url, { width: 120, margin: 1 }).then(setQrUrl).catch(() => {});
  }, [order.order_number]);

  // Save data back to order
  const saveData = async (patch) => {
    const newData = { ...order.data, ...patch };
    await updateOrder(order.id, newData);
  };

  // Toggle checklist
  const toggleCheck = (key) => {
    const next = { ...checklist, [key]: !checklist[key] };
    setChecklist(next);
    saveData({ checklist: next });
  };

  // Add comment
  const addComment = () => {
    if (!commentText.trim()) return;
    const c = { text: commentText.trim(), author: user?.name || 'Unknown', date: new Date().toISOString() };
    const next = [...comments, c];
    setComments(next);
    setCommentText('');
    saveData({ comments: next });
    toast.success('Комментарий добавлен');
  };

  // Photo upload
  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photos.length >= 3) { toast.warning('Максимум 3 фото'); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error('Файл > 2MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const next = [...photos, { name: file.name, data: reader.result, date: new Date().toISOString() }];
      setPhotos(next);
      saveData({ photos: next });
      toast.success('Фото загружено');
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = (idx) => {
    const next = photos.filter((_, i) => i !== idx);
    setPhotos(next);
    saveData({ photos: next });
  };

  // Sizes table
  const sizeEntries = Object.entries(d.sizes || {}).filter(([, v]) => v > 0);
  const customSizes = (d.customSizes || []).filter(c => c.qty > 0);
  const totalQty = order.total_qty || 0;
  const statusColor = STATUS_COLORS[order.status] || '#888';

  return (
    <div className="tc-overlay" onClick={onClose}>
      <div className="tc-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="tc-header">
          <div className="tc-header-left">
            <div className="tc-order-num">{order.order_number}</div>
            <div className="tc-status" style={{ background: statusColor }}>{STATUS_LABELS[order.status]}</div>
          </div>
          <div className="tc-header-right">
            {qrUrl && <img src={qrUrl} alt="QR" className="tc-qr" />}
            <button className="tc-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="tc-body">
          {/* Client */}
          <div className="tc-section">
            <div className="tc-section-title">Клиент</div>
            <div className="tc-kv"><span>Имя</span><b>{d.name || '—'}</b></div>
            {d.contact && <div className="tc-kv"><span>Контакт</span><b>{d.contact}</b></div>}
            {d.phone && <div className="tc-kv"><span>Телефон</span><b>{d.phone}</b></div>}
            {d.deadline && <div className="tc-kv"><span>Дедлайн</span><b>{d.deadline}</b></div>}
            {d.bitrixDeal && <div className="tc-kv"><span>Bitrix</span><b>{d.bitrixDeal}</b></div>}
          </div>

          {/* Product */}
          <div className="tc-section">
            <div className="tc-section-title">Изделие</div>
            <div className="tc-kv"><span>Тип</span><b>{d.sku?.name || TYPE_NAMES[d.type] || d.type}</b></div>
            {d.fabric && <div className="tc-kv"><span>Ткань</span><b>{FABRIC_NAMES[d.fabric] || d.fabric}</b></div>}
            <div className="tc-kv"><span>Цвет</span><b>{d.color}</b></div>
            <div className="tc-kv"><span>Лекала</span><b>{d.fit || 'regular'}</b></div>
            <div className="tc-kv"><span>Тираж</span><b>{totalQty} шт</b></div>
          </div>

          {/* Sizes */}
          {(sizeEntries.length > 0 || customSizes.length > 0) && (
            <div className="tc-section">
              <div className="tc-section-title">Размерная сетка</div>
              <div className="tc-sizes-grid">
                {sizeEntries.map(([s, q]) => (
                  <div key={s} className="tc-size-cell"><span className="tc-size-label">{s}</span><span className="tc-size-qty">{q}</span></div>
                ))}
                {customSizes.map(c => (
                  <div key={c.label} className="tc-size-cell"><span className="tc-size-label">{c.label}</span><span className="tc-size-qty">{c.qty}</span></div>
                ))}
              </div>
            </div>
          )}

          {/* Zones & Tech */}
          {(d.zones || []).length > 0 && (
            <div className="tc-section">
              <div className="tc-section-title">Нанесение</div>
              {d.zones.map(z => {
                const tech = d.zoneTechs?.[z] || 'screen';
                const p = d.zonePrints?.[z] || d.flexZones?.[z] || d.dtgZones?.[z] || d.embZones?.[z] || d.dtfZones?.[z] || {};
                return (
                  <div key={z} className="tc-zone-row">
                    <div className="tc-zone-name">{ZONE_LABELS[z] || z}</div>
                    <div className="tc-zone-tech">{TECH_NAMES[tech] || tech}</div>
                    {p.size && <div className="tc-zone-detail">Формат: {p.size}</div>}
                    {p.colors && <div className="tc-zone-detail">Цвета: {p.colors}</div>}
                    {p.fx && p.fx !== 'none' && <div className="tc-zone-detail">FX: {p.fx}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Notes */}
          {d.notes && (
            <div className="tc-section">
              <div className="tc-section-title">Примечания</div>
              <div className="tc-notes">{d.notes}</div>
            </div>
          )}

          {/* Checklist */}
          <div className="tc-section">
            <div className="tc-section-title">Чек-лист операций</div>
            {CHECKLIST_ITEMS.map(item => (
              <label key={item.key} className={`tc-check${checklist[item.key] ? ' done' : ''}`}>
                <input type="checkbox" checked={!!checklist[item.key]} onChange={() => toggleCheck(item.key)} />
                <span>{item.label}</span>
              </label>
            ))}
            {/* Per-zone print checklist */}
            {(d.zones || []).map(z => (
              <label key={`print-${z}`} className={`tc-check${checklist[`print-${z}`] ? ' done' : ''}`}>
                <input type="checkbox" checked={!!checklist[`print-${z}`]} onChange={() => toggleCheck(`print-${z}`)} />
                <span>Нанесение: {ZONE_LABELS[z] || z}</span>
              </label>
            ))}
          </div>

          {/* Photos */}
          <div className="tc-section">
            <div className="tc-section-title">Фото результата</div>
            <div className="tc-photos">
              {photos.map((p, i) => (
                <div key={i} className="tc-photo">
                  <img src={p.data} alt={p.name} />
                  <button className="tc-photo-rm" onClick={() => removePhoto(i)}>✕</button>
                </div>
              ))}
              {photos.length < 3 && (
                <div className="tc-photo-add" onClick={() => fileRef.current?.click()}>
                  <span>+</span>
                  <span className="tc-photo-add-text">Фото</span>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoUpload} />
          </div>

          {/* Comments */}
          <div className="tc-section">
            <div className="tc-section-title">Комментарии</div>
            {comments.length === 0 && <div className="tc-empty">Нет комментариев</div>}
            {comments.map((c, i) => (
              <div key={i} className="tc-comment">
                <div className="tc-comment-header">
                  <b>{c.author}</b>
                  <span>{new Date(c.date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="tc-comment-text">{c.text}</div>
              </div>
            ))}
            <div className="tc-comment-input">
              <input type="text" value={commentText} placeholder="Комментарий..." onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addComment()} />
              <button onClick={addComment}>Отправить</button>
            </div>
          </div>

          {/* Price */}
          <div className="tc-section tc-price">
            <div className="tc-kv"><span>Итого</span><b>{(order.total_sum || 0).toLocaleString('ru-RU')} ₽</b></div>
          </div>
        </div>

        {/* Footer */}
        <div className="tc-footer">
          <select value={order.status} onChange={e => onStatusChange?.(order.id, e.target.value)}>
            {STATUS_LIST.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          <button className="btn" onClick={() => window.print()}>Печать</button>
          <button className="btn" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
