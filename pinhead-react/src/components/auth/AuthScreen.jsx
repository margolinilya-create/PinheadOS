import { useState } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { useShallow } from 'zustand/react/shallow';
import { validatePassword } from '../../utils/validate';

export default function AuthScreen() {
  const [tab, setTab] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPass, setShowPass] = useState(false);
  const {
    login, register, error, loading, clearError,
    awaitingEmailConfirm, resendConfirmation, resendingConfirm, clearEmailConfirm,
    requestPasswordReset, sendingReset, resetSentTo, clearPasswordReset,
  } = useAuthStore(
    useShallow(s => ({
      login: s.login, register: s.register, error: s.error, loading: s.loading, clearError: s.clearError,
      awaitingEmailConfirm: s.awaitingEmailConfirm,
      resendConfirmation: s.resendConfirmation,
      resendingConfirm: s.resendingConfirm,
      clearEmailConfirm: s.clearEmailConfirm,
      requestPasswordReset: s.requestPasswordReset,
      sendingReset: s.sendingReset,
      resetSentTo: s.resetSentTo,
      clearPasswordReset: s.clearPasswordReset,
    }))
  );

  const switchTab = (t) => {
    setTab(t);
    clearError();
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    await login(email, password);
  };

  const [passError, setPassError] = useState('');

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!name || !email || !password) return;
    const pv = validatePassword(password);
    if (!pv.valid) { setPassError(pv.error); return; }
    setPassError('');
    const outcome = await register(name, email, password);
    // 'confirm_email' — экран подтверждения адреса поднимает стор (он же нужен
    // и при входе в неподтверждённый аккаунт), 'failed' — причина уже в `error`.
    if (outcome === 'signed_in') setTab('pending');
  };

  /**
   * Письмо со ссылкой на смену пароля ушло.
   *
   * Отдельный экран, а не тост: тост исчезнет через три секунды, а человеку
   * нужно переключиться в почту и вернуться — и всё это время он должен видеть,
   * куда именно письмо ушло.
   */
  if (resetSentTo) {
    return (
      <div className="auth-overlay">
        <div className="auth-card">
          <div className="auth-logo">✳ PINHEAD</div>
          <div className="auth-pending">
            <div className="auth-pending-icon">✉</div>
            <h3>Ссылка отправлена</h3>
            <p>Письмо со ссылкой на смену пароля ушло на адрес</p>
            <p className="auth-pending-email">{resetSentTo}</p>
            <p>Откройте ссылку из письма и задайте новый пароль. Письма нет — проверьте папку «Спам».</p>
            {error && <div className="auth-error">{error}</div>}
            <div className="auth-pending-actions">
              <button type="button" className="btn-secondary" onClick={clearPasswordReset}>
                Вернуться ко входу
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /**
   * Регистрация не закончена: адрес почты не подтверждён.
   *
   * Экран поднимается в двух случаях — сразу после регистрации и при попытке
   * войти в неподтверждённый аккаунт. Раньше не было ни того, ни другого:
   * после регистрации человек видел «ждите подтверждения администратора»
   * (администратор был ни при чём), а при входе — красную строку «Email
   * не подтверждён» без единой подсказки, что с этим делать.
   */
  if (awaitingEmailConfirm) {
    const backToLogin = () => {
      clearEmailConfirm();
      setTab('login');
    };
    return (
      <div className="auth-overlay">
        <div className="auth-card">
          <div className="auth-logo">✳ PINHEAD</div>
          <div className="auth-pending">
            <div className="auth-pending-icon">✉</div>
            <h3>Подтвердите адрес почты</h3>
            <p>Мы отправили письмо со ссылкой на адрес</p>
            <p className="auth-pending-email">{awaitingEmailConfirm}</p>
            <p>
              Откройте ссылку из письма — только после этого можно войти.
              Письма нет — проверьте папку «Спам».
            </p>
            {error && <div className="auth-error">{error}</div>}
            <div className="auth-pending-actions">
              <button
                type="button"
                className="btn-accent auth-submit"
                onClick={() => resendConfirmation()}
                disabled={resendingConfirm}
              >
                {resendingConfirm ? 'Отправляем...' : 'Отправить письмо повторно'}
              </button>
              <button type="button" className="btn-secondary" onClick={backToLogin}>
                Вернуться ко входу
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
              <label htmlFor="auth-login-email">Email</label>
              <input id="auth-login-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" autoComplete="email" autoFocus maxLength={254} />
            </div>
            <div className="auth-field">
              <label htmlFor="auth-login-password">Пароль</label>
              <div className="auth-pass-wrap">
                <input id="auth-login-password" type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" autoComplete="current-password" maxLength={128} />
                <button type="button" className="auth-pass-toggle" onClick={() => setShowPass(!showPass)}>
                  {showPass ? '👁' : '👁‍🗨'}
                </button>
              </div>
            </div>
            <button type="submit" className="btn-accent auth-submit" disabled={loading}>
              {loading ? 'Вход...' : 'Войти'}
            </button>
            {/* Восстановления не было вовсе: забывший пароль упирался в «Неверный
                email или пароль» и не имел ни одного выхода — повторная
                регистрация отвечает «адрес уже заведён» */}
            <button
              type="button"
              className="auth-forgot"
              disabled={sendingReset}
              onClick={() => {
                if (!email) { setPassError('Введите email — на него уйдёт ссылка'); return; }
                setPassError('');
                requestPasswordReset(email);
              }}
            >
              {sendingReset ? 'Отправляем...' : 'Забыли пароль?'}
            </button>
            {passError && tab === 'login' && <span className="auth-error">{passError}</span>}
          </form>
        ) : (
          <form className="auth-form" onSubmit={handleRegister}>
            <div className="auth-field">
              <label htmlFor="auth-reg-name">Имя</label>
              <input id="auth-reg-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ваше имя" autoComplete="name" maxLength={100} />
            </div>
            <div className="auth-field">
              <label htmlFor="auth-reg-email">Email</label>
              <input id="auth-reg-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" autoComplete="email" maxLength={254} />
            </div>
            <div className="auth-field">
              <label htmlFor="auth-reg-password">Пароль</label>
              <div className="auth-pass-wrap">
                <input id="auth-reg-password" type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="мин. 6 символов" autoComplete="new-password" maxLength={128} />
                <button type="button" className="auth-pass-toggle" onClick={() => setShowPass(!showPass)}>
                  {showPass ? '👁' : '👁‍🗨'}
                </button>
              </div>
              {passError && <span className="auth-error">{passError}</span>}
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
