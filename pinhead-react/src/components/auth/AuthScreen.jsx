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
  /** Сообщение, которого нет в сторе: занятый адрес сервер ошибкой не считает */
  const [notice, setNotice] = useState('');
  const { login, register, resendConfirmation, error, unconfirmedEmail, loading, clearError } = useAuthStore(
    useShallow(s => ({
      login: s.login,
      register: s.register,
      resendConfirmation: s.resendConfirmation,
      error: s.error,
      unconfirmedEmail: s.unconfirmedEmail,
      loading: s.loading,
      clearError: s.clearError,
    }))
  );

  const switchTab = (t) => {
    setTab(t);
    setNotice('');
    clearError();
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    setNotice('');
    await login(email, password);
  };

  const [passError, setPassError] = useState('');

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!name || !email || !password) return;
    const pv = validatePassword(password);
    if (!pv.valid) { setPassError(pv.error); return; }
    setPassError('');
    setNotice('');

    const outcome = await register(name, email, password);

    if (outcome.status === 'confirm_email') { setTab('confirm'); return; }
    /**
     * Подтверждение адреса выключено — сессия уже выдана, и профиль в сторе есть.
     * Экран регистрации свою работу закончил: дальше App сам покажет «ожидание
     * подтверждения администратором», и второй такой же экран здесь был бы враньём
     * про письмо, которого никто не отправлял.
     */
    if (outcome.status === 'signed_in') return;
    if (outcome.status === 'already_registered') {
      setNotice('Этот email уже зарегистрирован. Войдите под ним или обратитесь к администратору.');
      setTab('login');
      return;
    }
    // status === 'error' — причина уже лежит в error стора
  };

  /**
   * Экран после регистрации говорит то, что произошло НА САМОМ ДЕЛЕ.
   *
   * Прежний текст («заявка отправлена, администратор подтвердит доступ») называл
   * только второй шаг и умалчивал первый: в проекте включено подтверждение адреса,
   * и до перехода по ссылке из письма вход отвечает «Email не подтверждён».
   * Человек ждал администратора, администратор его одобрял, а войти всё равно
   * не получалось — и это и была та самая «ошибка при регистрации».
   */
  if (tab === 'confirm') {
    return (
      <div className="auth-overlay">
        <div className="auth-card">
          <div className="auth-logo">✳ PINHEAD</div>
          <div className="auth-pending">
            <div className="auth-pending-icon">✉</div>
            <h3>Подтвердите email</h3>
            <p>Мы отправили письмо со ссылкой на адрес:</p>
            <p className="auth-pending-email">{email}</p>
            <p>
              Откройте ссылку из письма — без этого вход невозможен.
              После подтверждения администратор откроет доступ к системе.
            </p>
            <p className="auth-note">Письмо не пришло? Проверьте папку «Спам».</p>
            {error && <div className="auth-error">{error}</div>}
            <div className="auth-pending-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={loading}
                onClick={() => resendConfirmation(email)}
              >
                {loading ? 'Отправка...' : 'Выслать письмо повторно'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => switchTab('login')}>
                Вернуться ко входу
              </button>
            </div>
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
        {notice && <div className="auth-error">{notice}</div>}

        {/*
          Неподтверждённый адрес — единственный отказ входа, который повтором
          ввода не лечится. Поэтому рядом с ошибкой стоит то, что действительно
          помогает, а не предложение попробовать ещё раз.
        */}
        {unconfirmedEmail && (
          <p className="auth-note">
            Регистрация не завершена: адрес не подтверждён.{' '}
            <button
              type="button"
              className="auth-linkbtn"
              disabled={loading}
              onClick={() => resendConfirmation(unconfirmedEmail)}
            >
              Выслать письмо повторно
            </button>
          </p>
        )}

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
            <p className="auth-note">
              После регистрации на этот адрес придёт письмо со ссылкой. Доступ откроет
              администратор — после того, как вы подтвердите адрес.
            </p>
            <button type="submit" className="btn-accent auth-submit" disabled={loading}>
              {loading ? 'Регистрация...' : 'Зарегистрироваться'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
