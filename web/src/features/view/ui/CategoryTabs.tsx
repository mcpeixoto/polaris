/**
 * The status-category pills a list wears above its rows.
 *
 * One control for every list. What it writes is the caller's: project lists keep their
 * `status` parameter, issue lists write `tab`. The pills themselves are the same row.
 */

import { SegmentedControl, type SegmentedOption } from '~/components';

export function CategoryTabs<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  readonly label: string;
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly options: readonly SegmentedOption<T>[];
  readonly className?: string | undefined;
}) {
  return (
    <SegmentedControl
      className={className}
      variant="bare"
      aria-label={label}
      value={value}
      onChange={onChange}
      options={options}
    />
  );
}
