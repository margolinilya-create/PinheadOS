import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/useAuthStore';
import { validatePassword } from '../../utils/validate';
import { networkFailureMessage } from '../../utils/i18n';
import { Skeleton } from '../shared/Skeleton';
import { EMPLOYEE_ROLE_LABELS } from '../../erp/types';

/**
 * Приглашение по ссылке — основной путь появления сотрудника.
 *
 * Прежний порядок был четырёхшаговым: человек регистрируется сам, подтверждает
 * адрес письмом, админ одобряет, админ назначает роль и цех. Письма шлёт
 * встроенный SMTP Supabase (лимит порядка двух в час, у gmail уходит в спам) —
 * из пяти учётных записей проекта самостоятельно регистрировались двое,
 * и застряли ОБА. Теперь админ отдаёт ссылку человеку сам, а роль и цех едут
 * в самом коде: после регистрации человек сразу внутри и сразу со своими
 * правами. Писем в этом пути нет вовсе.
 *
 * Экран лениво подгружается из `App.jsx`: он открывается один раз в жизни
 * сотрудника, и тянуть его (вместе со словарём ролей ERP) во входной чанк
 * ради этого незачем.
 */
export default function JoinScreen() {
  const [params] = useSearchParams();
  const code = params.get('code');

  const { register, error, loading, clearError } = useAuthStore(
    useShallow((s) => ({
      register: s.register, error: s.error, loading: s.loading, clearError: s.clearError,
    })),
  );

  const [invite, setInvite] = useState(null);
  /** null — ещё грузим; 'invalid' — код не действует; строка — сбой запроса */
  const [loadError, setLoadError] = useState(null);
  const [checked, setChecked] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passError, setPassError] = useState('');
  const [showPass, setShowPass] = useState(false);

  /**
   * Приглашение показывает серверная функция, а не выборка из таблицы: политика
   * для `anon` открыла бы ВСЕ приглашения разом — RLS не видит фильтр запроса
   * и не может ограничить выдачу одной строкой.
   */
  const loadInvite = useCallback(async () => {
    if (!code) { setChecked(true); setLoadError('invalid'); return; }
    setLoadError(null);
    setChecked(false);
    try {
      const { data, error: rpcError } = await supabase.rpc('erp_invite_preview', { p_code: code });
      if (rpcError) { setLoadError(rpcError.message); return; }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) { setLoadError('invalid'); return; }
      setInvite(row);
      if (row.email) setEmail(row.email);
    } catch (e) {
      // supabase-js БРОСАЕТ, когда ответа не было вовсе (нет сети, CORS)
      setLoadError(networkFailureMessage(e));
    } finally {
      setChecked(true);
    }
  }, [code]);

  useEffect(() => { loadInvite(); }, [loadInvite]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !email || !password) return;
    const pv = validatePassword(password);
    if (!pv.valid) { setPassError(pv.error); return; }
    setPassError('');
    clearError();
    // Дальше показывать нечего: сессия есть, профиль одобрен приглашением —
    // `App` сам отрисует рабочую оболочку.
    await register(name, email, password, { inviteCode: code });
  };

  const shell = (children) => (
    <div className="auth-overlay">
      <div className="auth-card">
        <div className="auth-logo">✳ PINHEAD</div>
        {children}
      </div>
    </div>
  );

  // Порядок состояний в проекте: ошибка → скелетон → результат
  if (loadError && loadError !== 'invalid') {
    return shell(
      <div className="auth-pending">
        <div className="auth-pending-icon">⚠</div>
        <h3>Не удалось проверить приглашение</h3>
        <p>{loadError}</p>
        <div className="auth-pending-actions">
          <button type="button" className="btn-accent auth-submit" onClick={loadInvite}>
            Повторить
          </button>
        </div>
      </div>,
    );
  }

  if (!checked) {
    return shell(
      <div className="auth-pending">
        <Skeleton height={12} width="50%" style={{ margin: '0 auto 12px' }} />
        <Skeleton height={20} width="70%" style={{ margin: '0 auto 24px' }} />
        <Skeleton height={44} />
      </div>,
    );
  }

  /**
   * Почему код не действует — не дело того, кто его открыл: истёк, отозван,
   * уже использован или выдан на другой адрес. Тупика при этом быть не должно,
   * поэтому рядом обычная регистрация — она осталась запасным путём.
   */
  if (loadError === 'invalid' || !invite) {
    return shell(
      <div className="auth-pending">
        <div className="auth-pending-icon">🔗</div>
        <h3>Ссылка не действует</h3>
        <p>
          Приглашение истекло, уже использовано или отозвано.
          Попросите администратора выслать новое.
        </p>
        <div className="auth-pending-actions">
          <a className="btn-secondary auth-submit auth-join-link" href="/">
            Обычная регистрация
          </a>
        </div>
      </div>,
    );
  }

  const roleLabel = EMPLOYEE_ROLE_LABELS[invite.employee_role] || invite.employee_role;

  return shell(
    <>
      <div className="auth-subtitle">Приглашение в систему</div>

      <div className="auth-join-invite">
        <div className="auth-join-role">{roleLabel}</div>
        {invite.department_name && (
          <div className="auth-join-dept">{invite.department_name}</div>
        )}
      </div>

      {error && <div className="auth-error">{error}</div>}

      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-field">
          <label htmlFor="join-name">Имя</label>
          <input
            id="join-name" type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ваше имя" autoComplete="name" autoFocus maxLength={100}
          />
        </div>
        <div className="auth-field">
          <label htmlFor="join-email">Email</label>
          <input
            id="join-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com" autoComplete="email" maxLength={254}
            // Приглашение на конкретный адрес: другой сервер всё равно не примет,
            // и давать его вводить значит обещать то, чего не будет
            disabled={Boolean(invite.email)}
          />
          {invite.email && (
            <span className="auth-join-hint">Приглашение выдано на этот адрес</span>
          )}
        </div>
        <div className="auth-field">
          <label htmlFor="join-password">Пароль</label>
          <div className="auth-pass-wrap">
            <input
              id="join-password" type={showPass ? 'text' : 'password'} value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="мин. 6 символов"
              autoComplete="new-password" maxLength={128}
            />
            <button type="button" className="auth-pass-toggle" onClick={() => setShowPass(!showPass)}>
              {showPass ? '👁' : '👁‍🗨'}
            </button>
          </div>
          {passError && <span className="auth-error">{passError}</span>}
        </div>
        <button type="submit" className="btn-accent auth-submit" disabled={loading}>
          {loading ? 'Создаём доступ...' : 'Начать работу'}
        </button>
      </form>
    </>,
  );
}
