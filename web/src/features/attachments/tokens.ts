/**
 * Subtitle date tokens: `{var__since}` and `{var__relativeTimestamp}` look up `var` in
 * the attachment's metadata and render it the way the rest of the product writes a time.
 */

import { when } from '~/features/time';

const TOKEN = /\{([A-Za-z_][A-Za-z0-9_]*)__(since|relativeTimestamp)\}/g;

export function formatSubtitle(
  subtitle: string,
  metadata: unknown,
  now: Date = new Date(),
): string {
  if (
    subtitle === '' ||
    metadata === null ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  ) {
    return subtitle;
  }
  const bag = metadata as Record<string, unknown>;
  return subtitle.replace(TOKEN, (whole, key: string) => {
    const raw = bag[key];
    if (typeof raw !== 'string' || raw === '') return whole;
    const instant = Date.parse(raw);
    if (Number.isNaN(instant)) return whole;
    return when(new Date(instant).toISOString(), now.getTime());
  });
}
