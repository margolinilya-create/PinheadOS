import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { SearchInput } from '../components/SearchInput';
import { Pipeline } from '../components/Pipeline';
import { useErpStore } from '../store/useErpStore';
import { toast } from '../../store/useToastStore';
import { matchesOrderQuery } from '../utils/orderSearch';
import styles from '../erp.module.css';
import { ExperimentalCard } from './experimental/ExperimentalCard';

/** Пайплайн фаз разработки образца (счётчики) — верх экрана */
const PIPE_PHASES = [
  { key: 'patterns', label: 'Лекала', icon: '📐' },
  { key: 'development', label: 'Проработка', icon: '🧵' },
  { key: 'final_fitting', label: 'Примерка', icon: '👕' },
  { key: 'done', label: 'Готов к серии', icon: '✅' },
];

/**
 * Экспериментальный цех (правка 6): отдельная воронка разработки.
 * Фазы: Построение лекал (конструктор) → Проработка (технолог) → Финальная примерка → Готов к серии.
 * Из «Проработки» — передачи в швейку/на нанесения с обязательным авто-возвратом.
 */

export default function Experimental() {
  const {
    orders, loaded, loadAll,
    experimental, experimentalLoaded, loadExperimental,
    createExperimental, updateExperimental, createExperimentalOp, completeExperimentalOp,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      loaded: s.loaded,
      loadAll: s.loadAll,
      experimental: s.experimental,
      experimentalLoaded: s.experimentalLoaded,
      loadExperimental: s.loadExperimental,
      createExperimental: s.createExperimental,
      updateExperimental: s.updateExperimental,
      createExperimentalOp: s.createExperimentalOp,
      completeExperimentalOp: s.completeExperimentalOp,
    })),
  );
  const [query, setQuery] = useState('');
  const [newOrderId, setNewOrderId] = useState('');

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  useEffect(() => { if (!experimentalLoaded) loadExperimental(); }, [experimentalLoaded, loadExperimental]);

  // Заказы-образцы без разработки — для создания
  const availableOrders = useMemo(() => {
    const withExp = new Set(experimental.map((e) => e.order_id));
    return orders.filter((o) => o.status === 'active' && !withExp.has(o.id));
  }, [orders, experimental]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return experimental;
    return experimental.filter((e) => {
      const o = orders.find((x) => x.id === e.order_id) || {
        title: e.order?.title, bitrix_id: e.order?.bitrix_id,
      };
      return matchesOrderQuery(o, q);
    });
  }, [experimental, orders, query]);

  // Воронка фаз: сколько разработок сейчас в каждой фазе (+ возврат конструктору сбоку)
  const pipeStages = useMemo(() => {
    const counts = {};
    for (const e of experimental) counts[e.phase] = (counts[e.phase] || 0) + 1;
    return PIPE_PHASES.map((p) => ({ ...p, count: counts[p.key] || 0 }));
  }, [experimental]);
  const returnedCount = useMemo(
    () => experimental.filter((e) => e.phase === 'returned_to_constructor').length,
    [experimental],
  );

  // Гейт «Проработки» (волна 4.3): материал принят складом? Нет заказа/материалов — свободно;
  // иначе ждём задачу приёмки склада в статусе «accepted».
  const materialReadyFor = (orderId) => {
    const o = orders.find((x) => x.id === orderId);
    if (!o || (o.materials?.length ?? 0) === 0) return true;
    const task = (o.warehouse_tasks ?? []).find((t) => t.task_type === 'material_receipt');
    return task ? task.status === 'accepted' : false;
  };

  const addExperimental = async () => {
    if (!newOrderId) { toast.error('Выберите заказ'); return; }
    const row = await createExperimental(newOrderId);
    if (row) setNewOrderId('');
  };

  return (
    <>
      <PageHead
        title="Экспериментальный цех"
        sub="Разработка образцов: лекала → проработка → примерка. Возвраты и передачи с авто-возвратом."
      />

      {experimentalLoaded && experimental.length > 0 && (
        <Pipeline
          stages={pipeStages}
          aside={{ key: 'returned', label: 'Возврат конструктору', icon: '↩', count: returnedCount }}
        />
      )}

      <div className={styles.toolbar}>
        <SearchInput value={query} onChange={setQuery} placeholder="Поиск: заказ, № сделки, изделие" ariaLabel="Поиск в эксперим. цехе" />
        <div className={styles.spacer} />
        <select className={styles.select} value={newOrderId} onChange={(e) => setNewOrderId(e.target.value)} aria-label="Заказ для разработки">
          <option value="">Заказ…</option>
          {availableOrders.map((o) => (
            <option key={o.id} value={o.id}>№{o.bitrix_id || '—'} · {o.title}</option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" onClick={addExperimental}>+ Разработка</button>
      </div>

      {experimentalLoaded && experimental.length === 0 && (
        <div className={styles.emptyState}>Эксперим. разработок пока нет — добавьте заказ-образец выше.</div>
      )}

      {rows.map((exp) => (
        <ExperimentalCard
          key={exp.id}
          exp={exp}
          materialReady={materialReadyFor(exp.order_id)}
          onUpdate={updateExperimental}
          onCreateOp={createExperimentalOp}
          onCompleteOp={completeExperimentalOp}
        />
      ))}
    </>
  );
}
