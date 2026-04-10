// Details slice: name, contact, email, phone, messenger, bitrixDeal, deadline, address, notes, role, packType, urgentOption, setField

type SetFn = (update: Record<string, unknown> | ((s: Record<string, unknown>) => Record<string, unknown>)) => void;

export const detailsSlice = (set: SetFn, _get: () => Record<string, unknown>) => ({
  phone: '', messenger: '', bitrixDeal: '', role: 'manager',
  name: '', contact: '', email: '', deadline: '', address: '', notes: '',
  packOption: false, packType: 'none', urgentOption: false,

  setField: (field: string, value: unknown) => set({ [field]: value }),
  togglePack: () => set((s: Record<string, unknown>) => ({ packOption: !s.packOption })),
  setPackType: (type: string) => set({ packType: type, packOption: type !== 'none' }),
  toggleUrgent: () => set((s: Record<string, unknown>) => ({ urgentOption: !s.urgentOption })),
});
