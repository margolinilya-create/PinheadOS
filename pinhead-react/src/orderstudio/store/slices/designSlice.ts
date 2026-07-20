// Design slice: zones, zoneTechs, zonePrints, flexZones, dtgZones, embZones, dtfZones, setZoneTech, setZoneParam, toggleZone

type SetFn = (update: Record<string, unknown> | ((s: Record<string, unknown>) => Record<string, unknown>)) => void;

export const designSlice = (set: SetFn, _get: () => Record<string, unknown>) => ({
  // ─── Zones & Tech ───
  toggleZone: (zone: string) => set((s: Record<string, unknown>) => {
    const zones = s.zones as string[];
    const has = zones.includes(zone);
    const newZones = has ? zones.filter((z: string) => z !== zone) : [...zones, zone];
    const zoneTechs = { ...(s.zoneTechs as Record<string, string>) };
    const zonePrints = { ...(s.zonePrints as Record<string, unknown>) };
    if (!has) {
      if (!zoneTechs[zone]) zoneTechs[zone] = 'screen';
      if (!zonePrints[zone]) zonePrints[zone] = { colors: 1, size: 'A4', textile: 'white', fx: 'none' };
    }
    return { zones: newZones, zoneTechs, zonePrints, noPrint: false };
  }),
  setZoneTech: (zone: string, tech: string) => set((s: Record<string, unknown>) => {
    const zoneTechs = { ...(s.zoneTechs as Record<string, string>), [zone]: tech };
    const updates: Record<string, unknown> = { zoneTechs, tech };
    const zonePrints = s.zonePrints as Record<string, unknown> | undefined;
    const flexZones = s.flexZones as Record<string, unknown> | undefined;
    const dtgZones = s.dtgZones as Record<string, unknown> | undefined;
    const embZones = s.embZones as Record<string, unknown> | undefined;
    const dtfZones = s.dtfZones as Record<string, unknown> | undefined;
    if (tech === 'screen' && !zonePrints?.[zone])
      updates.zonePrints = { ...zonePrints, [zone]: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } };
    if (tech === 'flex' && !flexZones?.[zone])
      updates.flexZones = { ...flexZones, [zone]: { colors: 1, size: 'A4' } };
    if (tech === 'dtg' && !dtgZones?.[zone])
      updates.dtgZones = { ...dtgZones, [zone]: { size: 'A4', textile: 'white' } };
    if (tech === 'embroidery' && !embZones?.[zone])
      updates.embZones = { ...embZones, [zone]: { width_mm: 50, height_mm: 50, fill: 1.0, extra: null } };
    if (tech === 'dtf' && !dtfZones?.[zone])
      updates.dtfZones = { ...dtfZones, [zone]: { fmt: 'A4', width_mm: 210, height_mm: 297 } };
    return updates;
  }),
  setZoneParam: (zone: string, tech: string, key: string, value: unknown) => set((s: Record<string, unknown>) => {
    const map: Record<string, string> = { screen: 'zonePrints', flex: 'flexZones', dtg: 'dtgZones', embroidery: 'embZones', dtf: 'dtfZones' };
    const field = map[tech];
    if (!field) return {};
    const current = s[field] as Record<string, Record<string, unknown>> | undefined;
    return { [field]: { ...current, [zone]: { ...(current?.[zone] || {}), [key]: value } } };
  }),
  toggleNoPrint: () => set((s: Record<string, unknown>) => ({
    noPrint: !s.noPrint,
    ...(!s.noPrint ? { zones: [] } : {}),
  })),
  setZoneArtwork: (zone: string, url: string) => set((s: Record<string, unknown>) => ({
    zoneArtworks: { ...(s.zoneArtworks as Record<string, string>), [zone]: url },
  })),
  artworkPath: '',
  setArtworkPath: (path: string) => set({ artworkPath: path }),
});
