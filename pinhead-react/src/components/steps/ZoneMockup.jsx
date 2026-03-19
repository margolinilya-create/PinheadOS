import { useMemo } from 'react';
import { getGarmentSVG } from '../../utils/mockup';
import { ZONE_LABELS, TECH_NAMES } from '../../data';

// Позиции зон на мокапе (% от размера SVG)
// Каждый тип изделия может иметь свои координаты
const ZONE_POSITIONS = {
  // Базовые позиции для торсовых изделий (tee, longsleeve, sweat, polo)
  _default: {
    front:         { top: 25, left: 20, width: 60, height: 45 },
    back:          { top: 25, left: 20, width: 60, height: 45 },
    chest:         { top: 25, left: 20, width: 60, height: 45 },
    'sleeve-l':    { top: 18, left: 0,  width: 22, height: 30 },
    'sleeve-r':    { top: 18, left: 78, width: 22, height: 30 },
    'left-sleeve': { top: 18, left: 0,  width: 22, height: 30 },
    'right-sleeve':{ top: 18, left: 78, width: 22, height: 30 },
    hood:          { top: 0,  left: 25, width: 50, height: 18 },
    pocket:        { top: 55, left: 30, width: 40, height: 18 },
  },
  hoodie: {
    front:         { top: 30, left: 20, width: 60, height: 40 },
    back:          { top: 30, left: 20, width: 60, height: 40 },
    chest:         { top: 30, left: 20, width: 60, height: 40 },
    'sleeve-l':    { top: 22, left: 0,  width: 22, height: 28 },
    'sleeve-r':    { top: 22, left: 78, width: 22, height: 28 },
    hood:          { top: 2,  left: 22, width: 56, height: 20 },
    pocket:        { top: 58, left: 28, width: 44, height: 16 },
  },
  shopper: {
    front:         { top: 20, left: 10, width: 80, height: 60 },
    back:          { top: 20, left: 10, width: 80, height: 60 },
    'back-bag':    { top: 20, left: 10, width: 80, height: 60 },
    'side-a':      { top: 20, left: 10, width: 80, height: 60 },
    'side-b':      { top: 20, left: 10, width: 80, height: 60 },
  },
  tank: {
    front:         { top: 20, left: 18, width: 64, height: 50 },
    back:          { top: 20, left: 18, width: 64, height: 50 },
  },
};

function getZonePos(garmentType, zoneId) {
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

export default function ZoneMockup({ garmentType, activeZones, onZoneClick,
  availableZones, color, zoneTechs, zonePrints, flexZones, dtgZones, embZones, dtfZones }) {

  const svgMarkup = useMemo(() => getGarmentSVG(garmentType, color), [garmentType, color]);

  const chips = useMemo(() => {
    if (!activeZones || activeZones.length === 0) return [];
    return activeZones.map(z =>
      getZoneChipText(z, zoneTechs, zonePrints, flexZones, dtgZones, embZones, dtfZones)
    );
  }, [activeZones, zoneTechs, zonePrints, flexZones, dtgZones, embZones, dtfZones]);

  const allZones = availableZones || [];

  return (
    <div className="zm-wrap">
      <div className="zm-mockup">
        <div className="zm-svg" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
        {allZones.map(z => {
          const pos = getZonePos(garmentType, z);
          if (!pos) return null;
          const isActive = activeZones?.includes(z);
          return (
            <div
              key={z}
              className={`zm-zone${isActive ? ' active' : ''}`}
              style={{
                top: `${pos.top}%`, left: `${pos.left}%`,
                width: `${pos.width}%`, height: `${pos.height}%`,
              }}
              onClick={() => onZoneClick?.(z)}
              title={ZONE_LABELS[z] || z}
            >
              <span className="zm-zone-label">{ZONE_LABELS[z] || z}</span>
            </div>
          );
        })}
      </div>
      {chips.length > 0 && (
        <div className="zm-summary">
          {chips.map((text, i) => (
            <span key={i} className="zm-chip">{text}</span>
          ))}
        </div>
      )}
    </div>
  );
}
