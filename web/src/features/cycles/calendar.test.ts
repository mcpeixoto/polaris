import { describe, expect, it } from 'vitest';

import { googleCalendarSubscribeURL } from './calendar';

describe('googleCalendarSubscribeURL', () => {
  it('wraps an https feed as webcal for Google Calendar', () => {
    const url = googleCalendarSubscribeURL('https://polaris.example/calendars/cycles/cal_abc');
    expect(url).toContain('calendar.google.com');
    expect(url).toContain(encodeURIComponent('webcal://polaris.example/calendars/cycles/cal_abc'));
  });
});
