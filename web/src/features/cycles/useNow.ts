/**
 * A clock that ticks, for screens whose whole content depends on the time.
 *
 * A cycle's phase is a comparison against now, and `Date.now()` read during render is a
 * comparison against the moment the screen mounted: a cycle detail left open across
 * midnight kept calling a finished window Current, kept offering to move its end date, and
 * kept counting the same number of days left. A minute is fine granularity for a boundary
 * measured in days, and it is one timer per screen rather than a re-render per second.
 */

import { useEffect, useState } from 'react';

export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
