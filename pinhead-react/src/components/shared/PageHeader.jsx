import { useNavigate } from 'react-router-dom';

export default function PageHeader({ title, badge, actions, tabs, activeTab, onTabChange }) {
  const navigate = useNavigate();

  return (
    <>
      <div className="page-header-bar">
        <div className="page-header-left">
          <button className="page-header-back" onClick={() => navigate('/')} aria-label="На главную">
            ← Назад
          </button>
          <h1 className="page-header-title">{title}</h1>
          {badge && <span className="page-header-badge">{badge}</span>}
        </div>
        <div className="page-header-actions">
          {actions}
        </div>
      </div>
      {tabs && (
        <div className="page-tabs">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`page-tab${activeTab === t.id ? ' active' : ''}`}
              onClick={() => onTabChange(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
