import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PlanPill } from './PlanPill';

describe('the plan pill', () => {
  it('opens billing for somebody who can change the plan', async () => {
    const onManage = vi.fn();
    render(<PlanPill name="Cloud Free" canManage onManage={onManage} />);

    await userEvent.setup().click(screen.getByRole('button', { name: /Cloud Free/ }));

    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it('is only a label for somebody who cannot', () => {
    render(<PlanPill name="Cloud Free" canManage={false} onManage={vi.fn()} />);

    expect(screen.getByText('Cloud Free')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
