import { useState, useEffect, memo } from 'react';
import { formatClock } from '../utils/format';

const Clock = memo(function Clock({ showDate = false, formatDateFn, className, dateClassName }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      {showDate && formatDateFn && <span className={dateClassName}>{formatDateFn(now)}</span>}
      <span className={className}>{formatClock(now)}</span>
    </>
  );
});

export default Clock;
