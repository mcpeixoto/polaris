/**
 * The filter grammar: one AST, validated once and compiled once.
 *
 *   `types.ts`     the AST, the field table and the display options — the definition both
 *                  the validator and the evaluator read.
 *   `validate.ts`  strict rejection at the boundary, matching the server's compiler.
 *   `evaluate.ts`  a validated AST compiled into a predicate over an issue.
 *   `relative.ts`  relative date tokens, resolved against an injected clock.
 *   `url.ts`       the readable URL form, so a filtered view is a link somebody can read
 *                  before they click it.
 *
 * The other half of this grammar is the server's SQL compiler, and the two are pinned to
 * each other by `schema/filter-conformance.json`, which both test suites run. When they
 * disagree, one of them fails — rather than both passing and the product being wrong.
 */

export {
  CUSTOMER_STATUSES,
  DEFAULT_DISPLAY,
  EMPTY_FILTER,
  FILTER_FIELDS,
  FILTER_OPS,
  isCustomerStatus,
  isFilterClause,
  isFilterField,
  isFilterGroup,
  isFilterOp,
  isStateCategory,
  operatorApplies,
  takesNoValues,
  takesSingleValue,
} from './types';
export type {
  Conjunction,
  DisplayDirection,
  DisplayGroupBy,
  DisplayOptions,
  DisplayOrderBy,
  DisplayProperty,
  FilterClause,
  FilterField,
  FilterFieldSpec,
  FilterGroup,
  FilterNode,
  FilterOp,
  FilterValueType,
  ViewLayout,
} from './types';

export { FilterError, isValidFilter, validateFilter } from './validate';

export { admitsStatus, compileFilter, filterIssues } from './evaluate';
export type { FilterContext, IssuePredicate } from './evaluate';

export {
  DISPLAY_PARAMS,
  FILTER_PARAM,
  filterSearchString,
  parseDisplayParams,
  parseFilterParam,
  toDisplayParams,
  toFilterParam,
} from './url';

export {
  formatDay,
  isRelativeToken,
  localDayOf,
  RELATIVE_KEYWORDS,
  resolveRelative,
  startOfDay,
} from './relative';
export type { CivilDay, RelativeKeyword, ResolvedRelative, TimeContext } from './relative';
