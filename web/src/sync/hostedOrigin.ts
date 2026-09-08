/**
 * The EU-hosted Polaris Cloud origin.
 *
 * Desktop ConnectServer and its tests import this so the string is not hard-coded ad hoc.
 * iOS keeps the same literal in `PolarisEnvironment.hosted` — there is no cross-language
 * package; keep the two equal by review.
 */
export const HOSTED_CLOUD_ORIGIN = 'https://polaris.peixotolabs.com';
