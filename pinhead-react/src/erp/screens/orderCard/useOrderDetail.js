import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { supabase } from '../../../lib/supabase';
import { useErpStore, orderPreviewUrl } from '../../store/useErpStore';
import { isOrderReadyToShip } from '../../utils/stageUi';

/**
 * Общая логика деталей заказа (загрузка события/аудит/комментарии + realtime, инлайн-правки,
 * плановые даты, отправка комментария, производные карты цехов/этапов). Переиспользуется
 * страницей `OrderCard` и боковым `OrderDrawer` — рендер у каждого свой.
 */
export function useOrderDetail(orderId) {
  const {
    orders, departments, loaded, loadAll, loadOne, setStagePlan,
    loadOrderEvents, loadOrderAudit, updateOrder, loadComments, addComment,
    profilesList, employees,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loaded: s.loaded,
      loadAll: s.loadAll,
      loadOne: s.loadOne,
      setStagePlan: s.setStagePlan,
      loadOrderEvents: s.loadOrderEvents,
      loadOrderAudit: s.loadOrderAudit,
      updateOrder: s.updateOrder,
      loadComments: s.loadComments,
      addComment: s.addComment,
      profilesList: s.profilesList,
      employees: s.employees,
    })),
  );
  const [events, setEvents] = useState(null);
  const [audit, setAudit] = useState(null);
  const [comments, setComments] = useState(null);
  const [previewErrorFor, setPreviewErrorFor] = useState(null);
  const previewError = previewErrorFor === orderId;
  const [lookedUpFor, setLookedUpFor] = useState(null);
  const lookedUp = lookedUpFor === orderId;

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  const inStore = orders.some((o) => o.id === orderId);
  useEffect(() => {
    if (!loaded || inStore || lookedUp || !orderId) return undefined;
    let alive = true;
    loadOne(orderId).finally(() => { if (alive) setLookedUpFor(orderId); });
    return () => { alive = false; };
  }, [loaded, inStore, lookedUp, loadOne, orderId]);

  useEffect(() => {
    if (!orderId) return undefined;
    // alive-гард: медленный ответ по прошлому заказу не перезаписывает текущий
    // (страница OrderCard дополнительно keyed по orderId — полный remount при A→B)
    let alive = true;
    loadOrderEvents(orderId).then((ev) => { if (alive) setEvents(ev ?? []); });
    loadOrderAudit(orderId).then((a) => { if (alive) setAudit(a ?? []); });
    loadComments(orderId).then((c) => { if (alive) setComments(c ?? []); });
    const channel = supabase
      .channel(`erp-comments-${orderId}-${crypto.randomUUID()}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'erp_order_comments', filter: `order_id=eq.${orderId}` },
        (payload) => {
          setComments((prev) => {
            if (!prev || prev.some((c) => c.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
        })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(channel); };
  }, [orderId, loadOrderEvents, loadOrderAudit, loadComments]);

  const order = orders.find((o) => o.id === orderId);
  const preview = order ? orderPreviewUrl(order) : null;
  const refreshAudit = () => loadOrderAudit(orderId).then((a) => setAudit(a ?? []));
  const saveOrderField = async (patch) => {
    const ok = await updateOrder(orderId, patch);
    if (ok) refreshAudit();
    return ok;
  };
  const onSavePlan = async (stageId, plan) => {
    const ok = await setStagePlan(stageId, plan);
    if (ok) refreshAudit();
    return ok;
  };
  const onSendComment = async (text) => {
    const row = await addComment(orderId, text);
    if (row) setComments((prev) => (prev && !prev.some((c) => c.id === row.id) ? [...prev, row] : prev));
    return row;
  };
  const readyToShip = order ? isOrderReadyToShip(order) : false;
  const shippedByName = useMemo(() => {
    if (!order?.shipped_by) return null;
    const p = profilesList.find((x) => x.id === order.shipped_by);
    if (p) return p.name || p.email;
    return employees.find((x) => x.profile_id === order.shipped_by)?.full_name ?? null;
  }, [order, profilesList, employees]);

  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const deptNameById = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  const stageById = useMemo(() => {
    const m = new Map();
    for (const it of order?.items ?? []) for (const st of it.stages) m.set(st.id, { st, it });
    return m;
  }, [order]);

  return {
    order, loaded, notFound: loaded && !order && lookedUp,
    events, audit, comments, preview, previewError, setPreviewErrorFor,
    saveOrderField, onSavePlan, onSendComment, readyToShip, shippedByName,
    deptById, deptNameById, stageById,
  };
}
