// Design slice: zones, zoneTechs, zonePrints, flexZones, dtgZones, embZones, dtfZones, setZoneTech, setZoneParam, toggleZone

export const designSlice = (set, _get) => ({
  // ─── Zones & Tech ───
  toggleZone: (zone) => set(s => {
    const has = s.zones.includes(zone);
    const zones = has ? s.zones.filter(z => z !== zone) : [...s.zones, zone];
    const zoneTechs = { ...s.zoneTechs };
    const zonePrints = { ...s.zonePrints };
    if (!has) {
      if (!zoneTechs[zone]) zoneTechs[zone] = 'screen';
      if (!zonePrints[zone]) zonePrints[zone] = { colors: 1, size: 'A4', textile: 'white', fx: 'none' };
    }
    return { zones, zoneTechs, zonePrints, noPrint: false };
  }),
  setZoneTech: (zone, tech) => set(s => {
    const zoneTechs = { ...s.zoneTechs, [zone]: tech };
    const updates = { zoneTechs, tech };
    if (tech === 'screen' && !s.zonePrints?.[zone])
      updates.zonePrints = { ...s.zonePrints, [zone]: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } };
    if (tech === 'flex' && !s.flexZones?.[zone])
      updates.flexZones = { ...s.flexZones, [zone]: { colors: 1, size: 'A4' } };
    if (tech === 'dtg' && !s.dtgZones?.[zone])
      updates.dtgZones = { ...s.dtgZones, [zone]: { size: 'A4', textile: 'white' } };
    if (tech === 'embroidery' && !s.embZones?.[zone])
      updates.embZones = { ...s.embZones, [zone]: { colors: 3, area: 's' } };
    if (tech === 'dtf' && !s.dtfZones?.[zone])
      updates.dtfZones = { ...s.dtfZones, [zone]: { size: 'A4' } };
    return updates;
  }),
  setZoneParam: (zone, tech, key, value) => set(s => {
    const map = { screen: 'zonePrints', flex: 'flexZones', dtg: 'dtgZones', embroidery: 'embZones', dtf: 'dtfZones' };
    const field = map[tech];
    if (!field) return {};
    return { [field]: { ...s[field], [zone]: { ...(s[field]?.[zone] || {}), [key]: value } } };
  }),
  toggleNoPrint: () => set(s => ({
    noPrint: !s.noPrint,
    ...(!s.noPrint ? { zones: [] } : {}),
  })),
  setZoneArtwork: (zone, url) => set(s => ({
    zoneArtworks: { ...s.zoneArtworks, [zone]: url },
  })),
});
