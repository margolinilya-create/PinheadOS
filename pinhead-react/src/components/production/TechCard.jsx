import { useState, useEffect, useRef } from 'react';
import { useOrdersStore, STATUS_LIST, STATUS_LABELS, STATUS_COLORS } from '../../store/useOrdersStore';
import { useAuthStore } from '../../store/useAuthStore';
import { TYPE_NAMES, FABRIC_NAMES, ZONE_LABELS, TECH_NAMES, SIZES } from '../../data';
import { toast } from '../shared/Toast';
import { getGarmentSVG } from '../../utils/mockup';
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
  const patchOrderData = useOrdersStore(s => s.patchOrderData);
  const user = useAuthStore(s => s.user);
  const d = order.data || {};

  const [checklist, setChecklist] = useState(d.checklist || {});
  const [comments, setComments] = useState(d.comments || []);
  const [photos, setPhotos] = useState(d.photos || []);
  const [commentText, setCommentText] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    const url = `${window.location.origin}/orders?order=${order.order_number}`;
    QRCode.toDataURL(url, { width: 120, margin: 1 }).then(setQrUrl).catch(() => {});
  }, [order.order_number]);

  const saveData = async (patch) => {
    await patchOrderData(order.id, patch);
  };

  const toggleCheck = (key) => {
    const next = { ...checklist, [key]: !checklist[key] };
    setChecklist(next);
    saveData({ checklist: next });
  };

  const addComment = () => {
    if (!commentText.trim()) return;
    const c = { text: commentText.trim(), author: user?.name || 'Unknown', date: new Date().toISOString() };
    const next = [...comments, c];
    setComments(next);
    setCommentText('');
    saveData({ comments: next });
    toast.success('Комментарий добавлен');
  };

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

  // Sizes
  const sizeEntries = d.sku?.category === 'accessories'
    ? [['ONE SIZE', d.sizes?.['ONE SIZE'] || 1]]
    : SIZES.map(s => [s, d.sizes?.[s] || 0]).filter(([, q]) => q > 0);
  const customSizes = (d.customSizes || []).filter(c => (parseInt(c.qty) || 0) > 0);
  const totalQty = order.total_qty || 0;
  const totalSum = order.total_sum || 0;
  const unitPrice = totalQty > 0 ? Math.round(totalSum / totalQty) : 0;
  const statusColor = STATUS_COLORS[order.status] || '#888';
  const createdAt = order.created_at ? new Date(order.created_at).toLocaleDateString('ru-RU') : '—';

  // Mockup
  const garmentType = d.type || order.item_type || '';
  const garmentColor = d.color || '#ccc';
  const mockupSVG = getGarmentSVG(garmentType, garmentColor);

  let sectionNum = 0;
  const nextSection = () => String(++sectionNum).padStart(2, '0');

  return (
    <div className="pp-overlay">
      {/* Toolbar */}
      <div className="pp-toolbar no-print">
        <select
          className="tc-status-select"
          value={order.status}
          onChange={e => onStatusChange?.(order.id, e.target.value)}
          style={{ borderLeft: `4px solid ${statusColor}` }}
        >
          {STATUS_LIST.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => window.print()}>ПЕЧАТЬ / PDF</button>
        <button className="btn" onClick={onClose}>ЗАКРЫТЬ</button>
      </div>

      <div className="pp-page">
        {/* Header */}
        <div className="pp-header">
          <div className="pp-logo">
            <svg className="pp-logo-mark" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
              <line x1="16" y1="2" x2="16" y2="30" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="2" y1="16" x2="30" y2="16" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="5" y1="5" x2="27" y2="27" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="27" y1="5" x2="5" y2="27" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            PINHEAD
          </div>
          <div className="pp-contacts">
            PNHD.RU / HELLO@PNHD.RU / +7 (812) 407-27-14
          </div>
        </div>

        {/* Title */}
        <div className="pp-title-row">
          <span className="pp-title">ТЕХНИЧЕСКОЕ ЗАДАНИЕ</span>
          <span className="pp-order-id">[{order.order_number}]</span>
        </div>

        {/* Two-column: Info + Mockup */}
        <div className="tc-doc-row">
          {/* Left column: product info */}
          <div className="tc-doc-info">
            <div className="pp-section">
              <div className="pp-section-head">
                <span className="pp-section-num">{nextSection()}</span>
                <span className="pp-section-name">ИЗДЕЛИЕ</span>
              </div>
              <div className="pp-kv">
                <div className="pp-kv-row">
                  <span>Тип</span><span className="pp-kv-dots" />
                  <b>{d.sku?.name || TYPE_NAMES[d.type] || d.type || '—'}</b>
                </div>
                {d.fabric && (
                  <div className="pp-kv-row">
                    <span>Ткань</span><span className="pp-kv-dots" />
                    <b>{FABRIC_NAMES[d.fabric] || d.fabric}</b>
                  </div>
                )}
                <div className="pp-kv-row">
                  <span>Цвет</span><span className="pp-kv-dots" />
                  <b>{d.color || '—'}</b>
                </div>
                <div className="pp-kv-row">
                  <span>Лекала</span><span className="pp-kv-dots" />
                  <b>{d.fit || 'regular'}</b>
                </div>
                <div className="pp-kv-row">
                  <span>Дата</span><span className="pp-kv-dots" />
                  <b>{createdAt}</b>
                </div>
                {d.deadline && (
                  <div className="pp-kv-row">
                    <span>Дедлайн</span><span className="pp-kv-dots" />
                    <b>{d.deadline}</b>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right column: Mockup visual */}
          <div className="tc-doc-mockup">
            {mockupSVG ? (
              <div className="tc-mockup-wrap">
                <div className="tc-mockup-svg" dangerouslySetInnerHTML={{ __html: mockupSVG }} />
                {(d.zones || []).length > 0 && (
                  <div className="tc-mockup-zones">
                    {d.zones.map(z => {
                      const tech = d.zoneTechs?.[z] || 'screen';
                      return (
                        <div key={z} className="tc-mockup-zone-tag">
                          <span className="tc-mz-dot" />
                          {ZONE_LABELS[z] || z} — {TECH_NAMES[tech] || tech}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="tc-mockup-empty">
                <span>{TYPE_NAMES[garmentType] || garmentType || 'Изделие'}</span>
              </div>
            )}
            {qrUrl && <img src={qrUrl} alt="QR" className="tc-doc-qr" />}
          </div>
        </div>

        {/* 02 Размеры и тираж */}
        {(sizeEntries.length > 0 || customSizes.length > 0) && (
          <div className="pp-section">
            <div className="pp-section-head">
              <span className="pp-section-num">{nextSection()}</span>
              <span className="pp-section-name">РАЗМЕРЫ И ТИРАЖ</span>
            </div>
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Размер</th>
                  <th>Кол-во</th>
                  <th>Цена/шт</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {sizeEntries.map(([size, qty]) => (
                  <tr key={size}>
                    <td>{size}</td>
                    <td>{qty}</td>
                    <td>{unitPrice.toLocaleString('ru-RU')} ₽</td>
                    <td><b>{(qty * unitPrice).toLocaleString('ru-RU')} ₽</b></td>
                  </tr>
                ))}
                {customSizes.map((c, i) => (
                  <tr key={`c-${i}`}>
                    <td>{c.label || c.size}</td>
                    <td>{c.qty}</td>
                    <td>{unitPrice.toLocaleString('ru-RU')} ₽</td>
                    <td><b>{((parseInt(c.qty) || 0) * unitPrice).toLocaleString('ru-RU')} ₽</b></td>
                  </tr>
                ))}
                <tr className="pp-table-total">
                  <td>ИТОГО</td>
                  <td><b>{totalQty}</b></td>
                  <td />
                  <td><b>{totalSum.toLocaleString('ru-RU')} ₽</b></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* 03 Нанесение */}
        {(d.zones || []).length > 0 && (
          <div className="pp-section">
            <div className="pp-section-head">
              <span className="pp-section-num">{nextSection()}</span>
              <span className="pp-section-name">НАНЕСЕНИЕ</span>
            </div>
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Зона</th>
                  <th>Техника</th>
                  <th>Параметры</th>
                </tr>
              </thead>
              <tbody>
                {d.zones.map(z => {
                  const tech = d.zoneTechs?.[z] || 'screen';
                  const p = d.zonePrints?.[z] || d.flexZones?.[z] || d.dtgZones?.[z] || d.embZones?.[z] || d.dtfZones?.[z] || {};
                  const params = [p.size, p.colors ? `${p.colors} цв.` : '', p.fx && p.fx !== 'none' ? `FX: ${p.fx}` : ''].filter(Boolean).join(', ') || '—';
                  return (
                    <tr key={z}>
                      <td>{ZONE_LABELS[z] || z}</td>
                      <td>{TECH_NAMES[tech] || tech}</td>
                      <td>{params}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Опции */}
        <div className="pp-section">
          <div className="pp-section-head">
            <span className="pp-section-num">{nextSection()}</span>
            <span className="pp-section-name">ОПЦИИ</span>
          </div>
          <div className="pp-kv">
            {d.urgent ? (
              <div className="pp-kv-row"><span>Срочный заказ</span><span className="pp-kv-dots" /><b>Да</b></div>
            ) : (
              <div className="pp-options-note">Стандартные условия</div>
            )}
            {d.pack && (
              <div className="pp-kv-row"><span>Упаковка</span><span className="pp-kv-dots" /><b>Да</b></div>
            )}
          </div>
        </div>

        {/* Клиент */}
        {(d.name || d.contact || d.phone || d.email) && (
          <div className="pp-section">
            <div className="pp-section-head">
              <span className="pp-section-num">{nextSection()}</span>
              <span className="pp-section-name">КЛИЕНТ</span>
            </div>
            <div className="pp-kv">
              {d.name && <div className="pp-kv-row"><span>Имя</span><span className="pp-kv-dots" /><b>{d.name}</b></div>}
              {d.phone && <div className="pp-kv-row"><span>Телефон</span><span className="pp-kv-dots" /><b>{d.phone}</b></div>}
              {d.contact && <div className="pp-kv-row"><span>Контакт</span><span className="pp-kv-dots" /><b>{d.contact}</b></div>}
              {d.email && <div className="pp-kv-row"><span>Email</span><span className="pp-kv-dots" /><b>{d.email}</b></div>}
              {d.address && <div className="pp-kv-row"><span>Адрес</span><span className="pp-kv-dots" /><b>{d.address}</b></div>}
              {d.bitrixDeal && <div className="pp-kv-row"><span>Bitrix</span><span className="pp-kv-dots" /><b>{d.bitrixDeal}</b></div>}
            </div>
          </div>
        )}

        {/* Заметки */}
        {d.notes && (
          <div className="pp-section">
            <div className="pp-section-head">
              <span className="pp-section-num">{nextSection()}</span>
              <span className="pp-section-name">ЗАМЕТКИ</span>
            </div>
            <div className="pp-notes">{d.notes}</div>
          </div>
        )}

        {/* Итого */}
        <div className="pp-grand-total">
          ИТОГО: {totalSum.toLocaleString('ru-RU')} ₽
        </div>

        {/* ═══ Interactive sections (hidden on print) ═══ */}
        <div className="tc-interactive no-print">
          {/* Чек-лист */}
          <div className="pp-section">
            <div className="pp-section-head">
              <span className="pp-section-num">{nextSection()}</span>
              <span className="pp-section-name">ЧЕК-ЛИСТ ОПЕРАЦИЙ</span>
            </div>
            <div className="tc-checklist">
              {CHECKLIST_ITEMS.map(item => (
                <label key={item.key} className={`tc-check${checklist[item.key] ? ' done' : ''}`}>
                  <input type="checkbox" checked={!!checklist[item.key]} onChange={() => toggleCheck(item.key)} />
                  <span>{item.label}</span>
                </label>
              ))}
              {(d.zones || []).map(z => (
                <label key={`print-${z}`} className={`tc-check${checklist[`print-${z}`] ? ' done' : ''}`}>
                  <input type="checkbox" checked={!!checklist[`print-${z}`]} onChange={() => toggleCheck(`print-${z}`)} />
                  <span>Нанесение: {ZONE_LABELS[z] || z}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Фото */}
          <div className="pp-section">
            <div className="pp-section-head">
              <span className="pp-section-num">{nextSection()}</span>
              <span className="pp-section-name">ФОТО РЕЗУЛЬТАТА</span>
            </div>
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

          {/* Комментарии */}
          <div className="pp-section">
            <div className="pp-section-head">
              <span className="pp-section-num">{nextSection()}</span>
              <span className="pp-section-name">КОММЕНТАРИИ</span>
            </div>
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
        </div>
      </div>
    </div>
  );
}
