import { useState } from 'react';
import { URGENT_DAY_OPTIONS, urgentRate } from '../../utils/costRules';
import { getPrices } from '../../utils/pricing';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { sanitizeText, validateEmail, validatePhone } from '../../utils/validate';
import { diffDays, factoryToday, URGENT_DAYS } from '../../utils/date';

const ROLES = [
  { key: 'manager', label: '👔 Менеджер' },
  { key: 'client', label: '🧑 Клиент' },
  { key: 'partner', label: '🤝 Партнёр' },
];

export default function StepDetails() {
  const { name, contact, email, phone, messenger, bitrixDeal, deadline, address, notes,
    role, packType, urgentDays, setField, setPackType, setUrgentDays, nextStep, prevStep } = useStore(
    useShallow(s => ({ name: s.name, contact: s.contact, email: s.email, phone: s.phone, messenger: s.messenger,
      bitrixDeal: s.bitrixDeal, deadline: s.deadline, address: s.address, notes: s.notes, role: s.role,
      packType: s.packType || 'none', urgentDays: s.urgentDays || (s.urgentOption ? 5 : 0), setField: s.setField, setPackType: s.setPackType,
      setUrgentDays: s.setUrgentDays, nextStep: s.nextStep, prevStep: s.prevStep }))
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
            <span className="field-error" role="alert" aria-live="polite">Обязательное поле</span>
          )}
        </div>
        <div className="form-field">
          <label htmlFor="field-contact">Контакт</label>
          <input id="field-contact" type="text" value={contact} placeholder="@telegram или телефон" maxLength={100} onChange={e => handleSanitizedChange('contact', e.target.value, 100)} />
        </div>
        <div className="form-field">
          <label htmlFor="field-email">Email</label>
          <input id="field-email" type="email" value={email} placeholder="mail@example.com" maxLength={100} onChange={e => handleEmailChange(e.target.value)} />
          {emailError && <span className="field-error" role="alert" aria-live="polite">{emailError}</span>}
        </div>
        <div className="form-field">
          <label htmlFor="field-phone">Телефон</label>
          <input id="field-phone" type="tel" value={phone} placeholder="+7 (999) 123-45-67" maxLength={20} onChange={e => handlePhoneChange(e.target.value)} />
          {phoneError && <span className="field-error" role="alert" aria-live="polite">{phoneError}</span>}
        </div>
        <div className="form-field">
          <label htmlFor="field-messenger">Мессенджер</label>
          <input id="field-messenger" type="text" value={messenger} placeholder="@username" maxLength={100} onChange={e => setField('messenger', e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="field-bitrix">Bitrix Deal</label>
          <input id="field-bitrix" type="text" value={bitrixDeal} placeholder="BX-12345" maxLength={100} onChange={e => setField('bitrixDeal', e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="field-deadline">Дедлайн <span style={{color:'var(--color-text-danger)',fontSize:11}}>важно</span></label>
          <input id="field-deadline" type="date" value={deadline} min={factoryToday()} onChange={e => setField('deadline', e.target.value)} />
          {deadline && diffDays(factoryToday(), deadline) <= URGENT_DAYS && (
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

      {/* Срочный пошив: на сколько дней сократить срок (правка 13.10) */}
      <div className="section-label" id="urgent-days-label">Срочный пошив</div>
      <div className="toggle-sub">Надбавка — к изделию с пошивом, после накладных и наценки; на нанесения не идёт</div>
      <div className="pack-options" role="radiogroup" aria-labelledby="urgent-days-label">
        {URGENT_DAY_OPTIONS.map(d => (
          <button key={d} type="button" role="radio" aria-checked={urgentDays === d}
            className={`pack-btn${urgentDays === d ? ' active' : ''}`}
            onClick={() => setUrgentDays(d)}>
            {d === 0 ? 'Обычный срок' : `На ${d} дней раньше`}
            {d > 0 && <span className="pack-price">+{Math.round(urgentRate(getPrices(), d) * 100)}%</span>}
          </button>
        ))}
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
