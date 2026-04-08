import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { TASKS } from '../data/tasks';
import { ORDER_MAP } from '../data/orders';
import { ROUTE_TEMPLATES, WORKSHOP_MAP, QC_ITEM_IDS } from '../data/workshops';


const useWorkshopStore = create((set, get) => ({
  currentWorkshop: 'screen',
  tasks: [...TASKS],
  orders: ORDER_MAP,
  selectedTaskId: null,
  showHandoff: false,
  showProblemPicker: false,

  // Events log per task
  events: {},        // { [taskId]: Event[] }
  // Comments per task
  comments: {},      // { [taskId]: Comment[] }
  // Photos per task
  photos: {},        // { [taskId]: Photo[] }
  // Notifications
  notifications: [], // Notification[]

  // QC Checklist
  qcChecklist: {},   // { [taskId]: { [itemId]: boolean } }

  // Defect tracking
  defects: {},       // { [taskId]: { count: number, type: string, notes: string, time: string } }

  // ── Actions ──

  setWorkshop: (code) => set({ currentWorkshop: code, selectedTaskId: null, showHandoff: false }),

  selectTask: (taskId) => set({ selectedTaskId: taskId, showHandoff: false, showProblemPicker: false }),

  closeTask: () => set({ selectedTaskId: null, showHandoff: false, showProblemPicker: false }),

  // ── Events & Comments ──

  _addEvent: (taskId, type, text) => {
    const evt = { id: crypto.randomUUID(), type, text, time: new Date().toISOString() };
    set(state => ({
      events: { ...state.events, [taskId]: [...(state.events[taskId] || []), evt] },
    }));
  },

  _addNotification: (type, title, body, taskId) => {
    set(state => ({
      notifications: [
        { id: crypto.randomUUID(), type, title, body, taskId, read: false, time: new Date().toISOString() },
        ...state.notifications,
      ],
    }));
  },

  addComment: (taskId, text) => {
    const trimmed = text.trim().slice(0, 2000);
    if (!trimmed) return;
    const comment = { id: crypto.randomUUID(), text: trimmed, author: 'Вы', time: new Date().toISOString() };
    set(state => ({
      comments: { ...state.comments, [taskId]: [...(state.comments[taskId] || []), comment] },
    }));
    get()._addEvent(taskId, 'comment', trimmed);
  },

  addPhoto: (taskId, dataUrl, caption) => {
    const existing = get().photos[taskId] || [];
    if (existing.length >= 10) return;
    if (dataUrl && dataUrl.length > 7 * 1024 * 1024) return; // ~5MB in base64
    const id = `p${Date.now()}`;
    const photo = { id, dataUrl, caption: caption || '', time: new Date().toISOString() };
    set(state => ({
      photos: { ...state.photos, [taskId]: [...(state.photos[taskId] || []), photo] },
    }));
    get()._addEvent(taskId, 'photo', caption ? `Фото: ${caption}` : 'Фото добавлено');
  },

  toggleQCItem: (taskId, itemId) => set(state => ({
    qcChecklist: {
      ...state.qcChecklist,
      [taskId]: {
        ...(state.qcChecklist[taskId] || {}),
        [itemId]: !(state.qcChecklist[taskId]?.[itemId]),
      },
    },
  })),

  isQCComplete: (taskId) => {
    const items = get().qcChecklist[taskId] || {};
    return QC_ITEM_IDS.every(id => items[id] === true);
  },

  reportDefect: (taskId, count, type, notes) => {
    const clampedCount = Math.max(0, Math.min(count, 9999));
    const clampedNotes = (notes || '').slice(0, 2000);
    set(state => ({
      defects: {
        ...state.defects,
        [taskId]: { count: clampedCount, type, notes: clampedNotes, time: new Date().toISOString() },
      },
    }));
    get()._addEvent(taskId, 'defect', `Брак: ${clampedCount} шт — ${type}${clampedNotes ? '. ' + clampedNotes : ''}`);
  },

  markNotificationsRead: () => {
    set(state => ({
      notifications: state.notifications.map(n => ({ ...n, read: true })),
    }));
  },

  startTask: (taskId) => {
    const task = get().tasks.find(t => t.id === taskId);
    if (!task || task.status !== 'ready') return;
    set(state => ({
      tasks: state.tasks.map(t =>
        t.id === taskId
          ? { ...t, status: 'in_progress', started_at: new Date().toISOString() }
          : t
      ),
    }));
    get()._addEvent(taskId, 'started', 'Задача взята в работу');
    const order = get().orders[task.order_id];
    get()._addNotification('started', order?.order_number || '', `${WORKSHOP_MAP[task.workshop_code]?.name || task.workshop_code} начал работу`, taskId);
  },

  openProblemPicker: () => set({ showProblemPicker: true }),

  blockTask: (taskId, problemType, problemNote) => {
    set(state => ({
      tasks: state.tasks.map(t =>
        t.id === taskId
          ? { ...t, status: 'blocked', previous_status: t.status, problem_type: problemType, problem_note: problemNote || null }
          : t
      ),
      showProblemPicker: false,
    }));
    get()._addEvent(taskId, 'blocked', `Проблема: ${problemNote || problemType}`);
    const task = get().tasks.find(t => t.id === taskId);
    if (task) {
      const order = get().orders[task.order_id];
      get()._addNotification('blocked', order?.order_number || '', `⚠ ${WORKSHOP_MAP[task.workshop_code]?.name}: ${problemNote || problemType}`, taskId);
    }
  },

  unblockTask: (taskId) => {
    set(state => ({
      tasks: state.tasks.map(t =>
        t.id === taskId
          ? { ...t, status: t.previous_status || 'ready', previous_status: null, problem_type: null, problem_note: null }
          : t
      ),
    }));
    get()._addEvent(taskId, 'unblocked', 'Проблема решена');
  },

  openHandoff: () => set({ showHandoff: true }),

  selectAndHandoff: (taskId) => set({ selectedTaskId: taskId, showHandoff: true, showProblemPicker: false }),

  completeTask: (taskId, handoffNote) => {
    const { tasks, orders } = get();
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const order = orders[task.order_id];
    const route = ROUTE_TEMPLATES[order.route];
    const currentIdx = route.indexOf(task.workshop_code);
    const nextWorkshop = currentIdx < route.length - 1 ? route[currentIdx + 1] : null;

    set(state => ({
      tasks: state.tasks.map(t => {
        if (t.id === taskId) {
          return { ...t, status: 'done', completed_at: new Date().toISOString() };
        }
        if (nextWorkshop && t.order_id === task.order_id && t.workshop_code === nextWorkshop && t.status === 'pending') {
          return { ...t, status: 'ready', handoff_note: handoffNote || null };
        }
        return t;
      }),
      selectedTaskId: null,
      showHandoff: false,
    }));
    get()._addEvent(taskId, 'completed', handoffNote ? `Завершено. Заметка: ${handoffNote}` : 'Завершено');
    if (nextWorkshop) {
      get()._addNotification('handoff', order?.order_number || '', `Передано в ${WORKSHOP_MAP[nextWorkshop]?.name || nextWorkshop}`, taskId);
    } else {
      get()._addNotification('complete', order?.order_number || '', 'Заказ полностью завершён!', taskId);
    }
  },
}));

// ── Standalone selectors (subscribe to reactive state) ──

export function useWorkshopTasks() {
  return useWorkshopStore(useShallow(s =>
    s.tasks.filter(t => t.workshop_code === s.currentWorkshop)
  ));
}

export function useTasksByOrder(orderId) {
  return useWorkshopStore(useShallow(s =>
    s.tasks.filter(t => t.order_id === orderId).sort((a, b) => a.seq - b.seq)
  ));
}

export default useWorkshopStore;
