import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';

const STORAGE_KEY = 'ph_draft_v2';
const SAVE_DELAY = 800; // ms debounce

// Поля которые сохраняем в черновик
const DRAFT_FIELDS = [
  'step', 'items', 'activeItemIdx',
  'type', 'fabric', 'color', 'sku', 'sizes', 'customSizes',
  'fit', 'fitChosen', 'extras', 'labels', 'zones', 'tech', 'textileColor',
  'zoneTechs', 'zonePrints', 'flexZones', 'dtgZones', 'embZones', 'dtfZones',
  'zoneArtworks', 'designNotes', 'sizeComment', 'phone', 'messenger', 'bitrixDeal',
  'role', 'name', 'contact', 'email', 'deadline', 'address', 'notes',
  'packOption', 'urgentOption', 'noPrint', 'labelConfig', 'colorSupplier', 'skuFilter',
];

function getDraftData(state) {
  const data = {};
  for (const key of DRAFT_FIELDS) {
    if (state[key] !== undefined) data[key] = state[key];
  }
  return data;
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearDraft() {
  localStorage.removeItem(STORAGE_KEY);
}

export function useDraft() {
  const [draftStatus, setDraftStatus] = useState('idle'); // idle | saving | saved
  const timerRef = useRef(null);
  const initialLoadRef = useRef(false);

  // Восстановление черновика при загрузке
  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;

    const draft = loadDraft();
    if (!draft) return;

    const updates = {};
    for (const key of DRAFT_FIELDS) {
      if (draft[key] !== undefined) updates[key] = draft[key];
    }
    // Восстанавливаем maxStep чтобы навигация работала
    if (draft.step) updates.maxStep = draft.step;
    useStore.setState(updates);
  }, []);

  // Подписка на изменения store — debounced save
  useEffect(() => {
    const unsub = useStore.subscribe((state) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setDraftStatus('saving');

      timerRef.current = setTimeout(() => {
        try {
          const data = getDraftData(state);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
          setDraftStatus('saved');
        } catch {
          setDraftStatus('idle');
        }
      }, SAVE_DELAY);
    });

    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const resetDraft = () => {
    clearDraft();
    useStore.getState().resetOrder();
    setDraftStatus('idle');
  };

  return { draftStatus, resetDraft };
}
