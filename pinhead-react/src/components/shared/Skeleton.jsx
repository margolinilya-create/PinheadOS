export function Skeleton({ width, height = 16, radius = 4, style }) {
  return (
    <div
      className="skeleton"
      style={{ width: width || '100%', height, borderRadius: radius, ...style }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <Skeleton height={8} width="60%" />
      <Skeleton height={14} width="80%" style={{ marginTop: 8 }} />
      <Skeleton height={10} width="40%" style={{ marginTop: 6 }} />
      <Skeleton height={10} width="50%" style={{ marginTop: 4 }} />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="skeleton-table">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-table-row">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} height={12} width={j === 0 ? '30%' : '60%'} />
          ))}
        </div>
      ))}
    </div>
  );
}
