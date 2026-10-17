import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/useAuthStore';
import { newOrderPath, startNewOrder } from './newOrder';

/** Кнопка «Новый заказ»: свой пустой черновик либо новый, затем вкладка «Изделие» */
export function useNewOrder() {
  const navigate = useNavigate();
  const uid = useAuthStore((s) => s.user?.id ?? null);
  const name = useAuthStore((s) => s.user?.name ?? '');
  const [busy, setBusy] = useState(false);
  const start = useCallback(async () => {
    setBusy(true);
    try {
      const id = await startNewOrder(uid, name);
      if (id) navigate(newOrderPath(id));
    } finally {
      setBusy(false);
    }
  }, [navigate, uid, name]);
  return { start, busy };
}
