// Details slice: name, contact, email, phone, messenger, bitrixDeal, deadline, address, notes, role, packOption, urgentOption, setField

export const detailsSlice = (set, _get) => ({
  phone: '', messenger: '', bitrixDeal: '', role: 'manager',
  name: '', contact: '', email: '', deadline: '', address: '', notes: '',
  packOption: false, urgentOption: false,

  setField: (field, value) => set({ [field]: value }),
  togglePack: () => set(s => ({ packOption: !s.packOption })),
  toggleUrgent: () => set(s => ({ urgentOption: !s.urgentOption })),
});
