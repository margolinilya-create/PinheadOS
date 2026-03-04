import { useState } from 'react';
import { useAuthStore } from '../../store/useAuthStore';

export default function AuthScreen() {
  const [tab, setTab] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPass, setShowPass] = useState(false);
  const { login, register, error, loading, clearError } = useAuthStore();

  const switchTab = (t) => {
    setTab(t);
    clearError();
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    await login(email, password);
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!name || !email || !password) return;
    const ok = await register(name, email, password);
    if (ok) setTab('pending');
  };

  if (tab === 'pending') {
    return (
      <div className="auth-overlay">
        <div className="auth-card">
          <div className="auth-logo">✳ PINHEAD</div>
          <div className="auth-pending">
            <div className="auth-pending-icon">⏳</div>
            <h3>Ожидание подтверждения</h3>
            <p>Ваша заявка отправлена. Администратор подтвердит доступ в ближайшее время.</p>
            <p className="auth-pending-email">{email}</p>
            <button className="btn-secondary" onClick={() => switchTab('login')}>Вернуться ко входу</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-overlay">
      <div className="auth-card">
        <div className="auth-logo">✳ PINHEAD</div>
        <div className="auth-subtitle">Order Studio</div>

        <div className="auth-tabs">
          <button className={`auth-tab${tab === 'login' ? ' active' : ''}`} onClick={() => switchTab('login')}>Вход</button>
          <button className={`auth-tab${tab === 'register' ? ' active' : ''}`} onClick={() => switchTab('register')}>Регистрация</button>
        </div>

        {error && <div className="auth-error">{error}</div>}

        {tab === 'login' ? (
          <form className="auth-form" onSubmit={handleLogin}>
            <div className="auth-field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" autoComplete="email" />
            </div>
            <div className="auth-field">
              <label>Пароль</label>
              <div className="auth-pass-wrap">
                <input type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" autoComplete="current-password" />
                <button type="button" className="auth-pass-toggle" onClick={() => setShowPass(!showPass)}>
                  {showPass ? '👁' : '👁‍🗨'}
                </button>
              </div>
            </div>
            <button type="submit" className="btn-accent auth-submit" disabled={loading}>
              {loading ? 'Вход...' : 'Войти'}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={handleRegister}>
            <div className="auth-field">
              <label>Имя</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ваше имя" autoComplete="name" />
            </div>
            <div className="auth-field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" autoComplete="email" />
            </div>
            <div className="auth-field">
              <label>Пароль</label>
              <div className="auth-pass-wrap">
                <input type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="мин. 6 символов" autoComplete="new-password" />
                <button type="button" className="auth-pass-toggle" onClick={() => setShowPass(!showPass)}>
                  {showPass ? '👁' : '👁‍🗨'}
                </button>
              </div>
            </div>
            <button type="submit" className="btn-accent auth-submit" disabled={loading}>
              {loading ? 'Регистрация...' : 'Зарегистрироваться'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
