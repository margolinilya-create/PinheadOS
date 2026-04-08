import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { sanitizeText, validateEmail, validatePhone } from '../../utils/validate';

const ROLES = [
  { key: 'manager', label: '👔 Менеджер' },
  { key: 'client', label: '🧑 Клиент' },
  { key: 'partner', label: '🤝 Партнёр' },
];

export default function StepDetails() {
  const { name, contact, email, phone, messenger, bitrixDeal, deadline, address, notes,
    role, packType, urgentOption, setField, setPackType, toggleUrgent, nextStep, prevStep } = useStore(
    useShallow(s => ({ name: s.name, contact: s.contact, email: s.email, phone: s.phone, messenger: s.messenger,
      bitrixDeal: s.bitrixDeal, deadline: s.deadline, address: s.address, notes: s.notes, role: s.role,
      packType: s.packType || 'none', urgentOption: s.urgentOption, setField: s.setField, setPackType: s.setPackType,
      toggleUrgent: s.toggleUrgent, nextStep: s.nextStep, prevStep: s.prevStep }))
  );
  const [showErrors, setShowErrors] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const isValid = name.trim().length > 0;

  const handleSanitizedChange = (field, value, maxLen) => {
    setField(field, sanitizeText(value, maxLen));
  };

  const handleEmailChange = (value) => {
    setField('email', sanitizeText(value, 100));
    const result = validateEmail(value.trim());
    setEmailError(result.valid ? '' : result.error);
  };

  const handlePhoneChange = (value) => {
    setField('phone', value.slice(0, 20));
    const result = validatePhone(value.trim());
    setPhoneError(result.valid ? '' : result.error);
  };

  const handleNext = () => {
    if (!isValid) { setShowErrors(true); return; }
    nextStep();
  };

  return (
    <div className="step-panel">
      <div className="step-header">
        <div className="step-header-label">// 04 — Детали</div>
        <h1 className="step-header-title">ДЕТАЛИ<br/>ЗАКАЗА</h1>
        <p className="step-header-desc">Заполните контактные данные и условия заказа</p>
      </div>
      {/* Role */}
      <div className="section-label">Роль</div>
      <div className="role-btns">
        {ROLES.map(r => (
          <button key={r.key} className={`role-btn${role === r.key ? ' active' : ''}`} onClick={() => setField('role', r.key)}>
            {r.label}
          </button>
        ))}
      </div>

      {/* Contact */}
      <div className="section-label">Контактные данные</div>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="field-name">Имя / Компания *</label>
          <input id="field-name" type="text" value={name} autoFocus
            className={showErrors && !name.trim() ? 'input-error' : ''}
            placeholder="Иванов Иван"
            maxLength={100}
            onChange={e => handleSanitizedChange('name', e.target.value, 100)} />
          {showErrors && !name.trim() && (
            <span className="field-error">Обязательное поле</span>
          )}
        </div>
        <div className="form-field">
          <label htmlFor="field-contact">Контакт</label>
          <input id="field-contact" type="text" value={contact} placeholder="@telegram или телефон" maxLength={100} onChange={e => handleSanitizedChange('contact', e.target.value, 100)} />
        </div>
        <div className="form-field">
          <label htmlFor="field-email">Email</label>
          <input id="field-email" type="email" value={email} placeholder="mail@example.com" maxLength={100} onChange={e => handleEmailChange(e.target.value)} />
          {emailError && <span className="field-error">{emailError}</span>}
        </div>
        <div className="form-field">
          <label htmlFor="field-phone">Телефон</label>
          <input id="field-phone" type="tel" value={phone} placeholder="+7 (999) 123-45-67" maxLength={20} onChange={e => handlePhoneChange(e.target.value)} />
          {phoneError && <span className="field-error">{phoneError}</span>}
        </div>
        <div className="form-field">
          <label htmlFor="field-messenger">Мессенджер</label>
          <input id="field-messenger" type="text" value={messenger} placeholder="@username" onChange={e => setField('messenger', e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="field-bitrix">Bitrix Deal</label>
          <input id="field-bitrix" type="text" value={bitrixDeal} placeholder="BX-12345" onChange={e => setField('bitrixDeal', e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="field-deadline">Дедлайн <span style={{color:'var(--color-text-danger)',fontSize:11}}>важно</span></label>
          <input id="field-deadline" type="date" value={deadline} min={new Date().toISOString().split('T')[0]} onChange={e => setField('deadline', e.target.value)} />
          {deadline && (new Date(deadline) - new Date()) < 3 * 24 * 60 * 60 * 1000 && (
            <div style={{fontSize:12, color:'var(--color-text-warning)', marginTop:4}}>
              Срочный срок — уточните с производством
            </div>
          )}
        </div>
      </div>

      {/* Delivery */}
      <div className="section-label">Доставка и опции</div>
      <div className="form-grid">
        <div className="form-field full">
          <label htmlFor="field-address">Адрес доставки</label>
          <input id="field-address" type="text" value={address} placeholder="Город, улица, дом..." maxLength={200} onChange={e => handleSanitizedChange('address', e.target.value, 200)} />
        </div>
        <div className="form-field full">
          <label htmlFor="field-notes">Примечания</label>
          <textarea id="field-notes" value={notes} placeholder="Дополнительная информация..." maxLength={500} onChange={e => handleSanitizedChange('notes', e.target.value, 500)} />
        </div>
      </div>

      {/* Pack Options */}
      <div className="section-label">Упаковка</div>
      <div className="pack-options">
        {[
          {key:'none', name:'Без упаковки',  price:0},
          {key:'bopp', name:'БОПП пакет',    price:20},
          {key:'zip',  name:'ЗИП пакет',     price:40},
        ].map(opt => (
          <button key={opt.key}
            className={`pack-btn${packType === opt.key ? ' active' : ''}`}
            onClick={() => setPackType(opt.key)}>
            {opt.name}
            {opt.price > 0 && <span className="pack-price">+{opt.price} ₽/шт</span>}
          </button>
        ))}
      </div>

      {/* Toggle Options */}
      <div className="toggle-row">
        <div>
          <div className="toggle-label-text">Срочное производство (+20%)</div>
          <div className="toggle-sub">Приоритет в очереди производства</div>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={urgentOption} onChange={toggleUrgent} />
          <span className="toggle-slider" />
        </label>
      </div>

      <div className="btn-row">
        <button className="btn-prev" onClick={prevStep}>← Назад</button>
        <button className={`btn-next${!isValid ? ' disabled' : ''}`}
          onClick={handleNext}>
          Далее
        </button>
      </div>
    </div>
  );
}
