import { useState } from 'react';
import { useStore } from '../../store/useStore';

const ROLES = [
  { key: 'manager', label: '👔 Менеджер' },
  { key: 'client', label: '🧑 Клиент' },
  { key: 'partner', label: '🤝 Партнёр' },
];

export default function StepDetails() {
  const { name, contact, email, phone, messenger, bitrixDeal, deadline, address, notes,
    role, packOption, urgentOption, setField, togglePack, toggleUrgent, nextStep, prevStep } = useStore();
  const [showErrors, setShowErrors] = useState(false);
  const isValid = name.trim().length > 0;
  const handleNext = () => {
    if (!isValid) { setShowErrors(true); return; }
    nextStep();
  };

  return (
    <div className="step-panel">
      <div className="step-header">
        <div className="step-header-label">// 05 — Детали</div>
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
          <label>Имя / Компания *</label>
          <input type="text" value={name}
            className={showErrors && !name.trim() ? 'input-error' : ''}
            placeholder="Иванов Иван"
            onChange={e => setField('name', e.target.value)} />
          {showErrors && !name.trim() && (
            <span className="field-error">Обязательное поле</span>
          )}
        </div>
        <div className="form-field">
          <label>Контакт</label>
          <input type="text" value={contact} placeholder="@telegram или телефон" onChange={e => setField('contact', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Email</label>
          <input type="email" value={email} placeholder="mail@example.com" onChange={e => setField('email', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Телефон</label>
          <input type="tel" value={phone} placeholder="+7 (999) 123-45-67" onChange={e => setField('phone', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Мессенджер</label>
          <input type="text" value={messenger} placeholder="@username" onChange={e => setField('messenger', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Bitrix Deal</label>
          <input type="text" value={bitrixDeal} placeholder="BX-12345" onChange={e => setField('bitrixDeal', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Дедлайн</label>
          <input type="date" value={deadline} onChange={e => setField('deadline', e.target.value)} />
        </div>
      </div>

      {/* Delivery */}
      <div className="section-label">Доставка и опции</div>
      <div className="form-grid">
        <div className="form-field full">
          <label>Адрес доставки</label>
          <input type="text" value={address} placeholder="Город, улица, дом..." onChange={e => setField('address', e.target.value)} />
        </div>
        <div className="form-field full">
          <label>Примечания</label>
          <textarea value={notes} placeholder="Дополнительная информация..." onChange={e => setField('notes', e.target.value)} />
        </div>
      </div>

      {/* Toggle Options */}
      <div className="toggle-row">
        <div>
          <div className="toggle-label-text">Индивидуальная упаковка (+15 ₽/шт)</div>
          <div className="toggle-sub">Каждое изделие в индивидуальном пакете</div>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={packOption} onChange={togglePack} />
          <span className="toggle-slider" />
        </label>
      </div>
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
