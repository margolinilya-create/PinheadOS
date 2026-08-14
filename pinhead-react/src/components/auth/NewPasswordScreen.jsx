import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../../store/useAuthStore';
import { validatePassword } from '../../utils/validate';

/**
 * Новый пароль по ссылке из письма.
 *
 * Ссылка восстановления не «открывает форму» — она ВХОДИТ человека: Supabase
 * выдаёт сессию и присылает `PASSWORD_RECOVERY`. Поэтому экран поднимается
 * в `App` ПЕРЕД проверкой пользователя и перекрывает оболочку: иначе человек
 * оказался бы просто внутри, так и не задав пароль, и в следующий раз снова
 * пришёл бы за ссылкой — с тем же результатом.
 */
export default function NewPasswordScreen() {
  const { completePasswordReset, savingPassword, error } = useAuthStore(
    useShallow((s) => ({
      completePasswordReset: s.completePasswordReset,
      savingPassword: s.savingPassword,
      error: s.error,
    })),
  );

  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [formError, setFormError] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    const pv = validatePassword(password);
    if (!pv.valid) { setFormError(pv.error); return; }
    if (password !== repeat) { setFormError('Пароли не совпадают'); return; }
    setFormError('');
    await completePasswordReset(password);
  };

  return (
    <div className="auth-overlay">
      <div className="auth-card">
        <div className="auth-logo">✳ PINHEAD</div>
        <div className="auth-subtitle">Новый пароль</div>

        {error && <div className="auth-error">{error}</div>}

        <form className="auth-form" onSubmit={onSubmit}>
          <div className="auth-field">
            <label htmlFor="new-password">Новый пароль</label>
            <div className="auth-pass-wrap">
              <input
                id="new-password" type={showPass ? 'text' : 'password'} value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="мин. 6 символов"
                autoComplete="new-password" autoFocus maxLength={128}
              />
              <button type="button" className="auth-pass-toggle" onClick={() => setShowPass(!showPass)}>
                {showPass ? '👁' : '👁‍🗨'}
              </button>
            </div>
          </div>
          <div className="auth-field">
            <label htmlFor="new-password-repeat">Повторите пароль</label>
            <input
              id="new-password-repeat" type={showPass ? 'text' : 'password'} value={repeat}
              onChange={(e) => setRepeat(e.target.value)} placeholder="ещё раз"
              autoComplete="new-password" maxLength={128}
            />
            {formError && <span className="auth-error">{formError}</span>}
          </div>
          <button type="submit" className="btn-accent auth-submit" disabled={savingPassword}>
            {savingPassword ? 'Сохраняем...' : 'Сохранить и войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
