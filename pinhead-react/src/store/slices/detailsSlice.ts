// Details slice: name, contact, email, phone, messenger, bitrixDeal, deadline, address, notes, role, packType, urgentOption, setField

type SetFn = (update: Record<string, unknown> | ((s: Record<string, unknown>) => Record<string, unknown>)) => void;

export const detailsSlice = (set: SetFn, _get: () => Record<string, unknown>) => ({
  phone: '', messenger: '', bitrixDeal: '', role: 'manager',
  name: '', contact: '', email: '', deadline: '', address: '', notes: '',
  packOption: false, packType: 'none', urgentOption: false,
  /** Срочный пошив: на сколько дней сокращён срок (0/5/10/15); urgentOption = days > 0 */
  urgentDays: 0,

  setField: (field: string, value: unknown) => set({ [field]: value }),
  togglePack: () => set((s: Record<string, unknown>) => ({ packOption: !s.packOption })),
  setPackType: (type: string) => set({ packType: type, packOption: type !== 'none' }),
  toggleUrgent: () => set((s: Record<string, unknown>) => (s.urgentOption
    ? { urgentOption: false, urgentDays: 0 }
    : { urgentOption: true, urgentDays: 5 })),
  setUrgentDays: (days: number) => set({ urgentDays: days, urgentOption: days > 0 }),
});
