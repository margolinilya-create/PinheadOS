import { useMemo } from 'react';
import { getGarmentSVG } from '../../utils/mockup';
import { ZONE_LABELS, TECH_NAMES } from '../../data';

// Соотношение сторон SVG-мокапов (width / height из viewBox)
const GARMENT_ASPECT = {
  tee:         3099 / 2693,
  longsleeve:  3926 / 2693,
  polo:        3747 / 2693,
  sweat:       3926 / 2693,
  hoodie:      3714 / 3067,
  'zip-hoodie':3714 / 3067,
  shopper:     2834.7 / 2480.3,
  tank:        220 / 250,
  'half-zip':  220 / 255,
  pants:       220 / 290,
  shorts:      220 / 200,
};

// Позиции зон на мокапе (% от размера SVG-контента)
const ZONE_POSITIONS = {
  _default: {
    front:         { top: 28, left: 28, width: 44, height: 38 },
    back:          { top: 28, left: 28, width: 44, height: 38 },
    chest:         { top: 28, left: 28, width: 44, height: 38 },
    'sleeve-l':    { top: 16, left: 4,  width: 20, height: 28 },
    'sleeve-r':    { top: 16, left: 76, width: 20, height: 28 },
    'left-sleeve': { top: 16, left: 4,  width: 20, height: 28 },
    'right-sleeve':{ top: 16, left: 76, width: 20, height: 28 },
    hood:          { top: 0,  left: 30, width: 40, height: 16 },
    pocket:        { top: 58, left: 34, width: 32, height: 14 },
  },
  tee: {
    front:         { top: 25, left: 30, width: 40, height: 40 },
    back:          { top: 25, left: 30, width: 40, height: 40 },
    chest:         { top: 25, left: 30, width: 40, height: 40 },
    'sleeve-l':    { top: 14, left: 6,  width: 20, height: 26 },
    'sleeve-r':    { top: 14, left: 74, width: 20, height: 26 },
    'left-sleeve': { top: 14, left: 6,  width: 20, height: 26 },
    'right-sleeve':{ top: 14, left: 74, width: 20, height: 26 },
  },
  longsleeve: {
    front:         { top: 26, left: 30, width: 40, height: 42 },
    back:          { top: 26, left: 30, width: 40, height: 42 },
    chest:         { top: 26, left: 30, width: 40, height: 42 },
    'sleeve-l':    { top: 18, left: 2,  width: 24, height: 48 },
    'sleeve-r':    { top: 18, left: 74, width: 24, height: 48 },
    'left-sleeve': { top: 18, left: 2,  width: 24, height: 48 },
    'right-sleeve':{ top: 18, left: 74, width: 24, height: 48 },
  },
  polo: {
    front:         { top: 26, left: 30, width: 40, height: 42 },
    back:          { top: 26, left: 30, width: 40, height: 42 },
    chest:         { top: 26, left: 30, width: 40, height: 42 },
    'sleeve-l':    { top: 16, left: 4,  width: 22, height: 28 },
    'sleeve-r':    { top: 16, left: 74, width: 22, height: 28 },
    'left-sleeve': { top: 16, left: 4,  width: 22, height: 28 },
    'right-sleeve':{ top: 16, left: 74, width: 22, height: 28 },
  },
  sweat: {
    front:         { top: 26, left: 30, width: 40, height: 42 },
    back:          { top: 26, left: 30, width: 40, height: 42 },
    chest:         { top: 26, left: 30, width: 40, height: 42 },
    'sleeve-l':    { top: 18, left: 2,  width: 24, height: 48 },
    'sleeve-r':    { top: 18, left: 74, width: 24, height: 48 },
    'left-sleeve': { top: 18, left: 2,  width: 24, height: 48 },
    'right-sleeve':{ top: 18, left: 74, width: 24, height: 48 },
  },
  hoodie: {
    front:         { top: 30, left: 28, width: 44, height: 36 },
    back:          { top: 30, left: 28, width: 44, height: 36 },
    chest:         { top: 30, left: 28, width: 44, height: 36 },
    'sleeve-l':    { top: 22, left: 2,  width: 22, height: 38 },
    'sleeve-r':    { top: 22, left: 76, width: 22, height: 38 },
    hood:          { top: 2,  left: 28, width: 44, height: 20 },
    pocket:        { top: 60, left: 32, width: 36, height: 12 },
  },
  'zip-hoodie': {
    front:         { top: 30, left: 28, width: 44, height: 36 },
    back:          { top: 30, left: 28, width: 44, height: 36 },
    chest:         { top: 30, left: 28, width: 44, height: 36 },
    'sleeve-l':    { top: 22, left: 2,  width: 22, height: 38 },
    'sleeve-r':    { top: 22, left: 76, width: 22, height: 38 },
    hood:          { top: 2,  left: 28, width: 44, height: 20 },
    pocket:        { top: 60, left: 32, width: 36, height: 12 },
  },
  shopper: {
    front:         { top: 22, left: 15, width: 70, height: 55 },
    back:          { top: 22, left: 15, width: 70, height: 55 },
    'back-bag':    { top: 22, left: 15, width: 70, height: 55 },
    'side-a':      { top: 22, left: 15, width: 70, height: 55 },
    'side-b':      { top: 22, left: 15, width: 70, height: 55 },
  },
  tank: {
    front:         { top: 22, left: 22, width: 56, height: 46 },
    back:          { top: 22, left: 22, width: 56, height: 46 },
  },
};

function _getZonePos(garmentType, zoneId) {
  const typeMap = ZONE_POSITIONS[garmentType] || ZONE_POSITIONS._default;
  return typeMap[zoneId] || ZONE_POSITIONS._default[zoneId] || null;
}

// Краткое имя техники для чипа
const TECH_SHORT = {
  screen: 'Шелко', flex: 'Флекс', dtg: 'DTG', embroidery: 'Выш.', dtf: 'DTF',
};

function getZoneChipText(zone, zoneTechs, zonePrints, flexZones, dtgZones, embZones, dtfZones) {
  const tech = zoneTechs?.[zone] || 'screen';
  const techLabel = TECH_SHORT[tech] || tech;
  let detail = '';

  if (tech === 'screen') {
    const p = zonePrints?.[zone];
    if (p) detail = ` ${p.size || 'A4'} (${p.colors || 1}цв.)`;
  } else if (tech === 'flex') {
    const p = flexZones?.[zone];
    if (p) detail = ` ${p.size || 'A4'} (${p.colors || 1}цв.)`;
  } else if (tech === 'dtg') {
    const p = dtgZones?.[zone];
    if (p) detail = ` ${p.size || 'A4'}`;
  } else if (tech === 'embroidery') {
    const p = embZones?.[zone];
    if (p) detail = ` ${(p.area || 's').toUpperCase()}`;
  } else if (tech === 'dtf') {
    const p = dtfZones?.[zone];
    if (p) detail = ` ${p.size || 'A4'}`;
  }

  return `${ZONE_LABELS[zone] || zone} — ${techLabel}${detail}`;
}

export default function ZoneMockup({ garmentType, activeZones, onZoneClick: _onZoneClick,
  availableZones: _availableZones, color, zoneTechs, zonePrints, flexZones, dtgZones, embZones, dtfZones }) {

  const svgMarkup = useMemo(() => getGarmentSVG(garmentType, color), [garmentType, color]);

  // Zone chip text computation (kept for future use)
  useMemo(() => {
    if (!activeZones || activeZones.length === 0) return [];
    return activeZones.map(z =>
      getZoneChipText(z, zoneTechs, zonePrints, flexZones, dtgZones, embZones, dtfZones)
    );
  }, [activeZones, zoneTechs, zonePrints, flexZones, dtgZones, embZones, dtfZones]);

  const aspect = GARMENT_ASPECT[garmentType] || 1;

  return (
    <div className="zm-wrap">
      <div className="zm-mockup" style={{ aspectRatio: aspect }}>
        <div className="zm-svg" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
      </div>
    </div>
  );
}
