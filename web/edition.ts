// Which edition this bundle is, and where `@ee/*` resolves because of it.
//
// docs/06-product-model/01-licensing-and-distribution.md specifies the mechanism:
//
//   "TypeScript, via a build-time alias that resolves `@ee/*` either to `web/src/ee` or to
//    a stub module that renders upgrade prompts. Vite `resolve.alias`, switched by
//    `POLARIS_EDITION`."
//
// The commercial half lives at `../ee/web` rather than at `web/src/ee`, and the difference
// is legal rather than cosmetic. ee/LICENSE governs "the contents of the `ee/` directory"
// and closes with the rule that decides this: "If a file's placement is ambiguous, the
// directory it lives in decides — and a file that would be ambiguous belongs in the core."
// A directory called `ee` nested inside AGPL source is exactly the ambiguity that rule
// refuses, so the enterprise code sits under the licence that names it.
//
// This file exists so vite.config.ts, vitest.config.ts and tsconfig.json cannot disagree.
// Three copies of one alias is three chances for the test runner to resolve a different
// module than the bundler — which would mean the suite proves the stub works and the
// shipped bundle contains something nobody tested, with no error anywhere to say so.
// tsconfig cannot import this (TypeScript resolves `paths` statically, before any code
// runs), so it is pinned to the core stub and the ee edition gets tsconfig.ee.json; that is
// the one duplication left, and it is checked by scripts/lint-editions.sh.
import { fileURLToPath, URL } from 'node:url';

/** The enterprise build. Anything else — unset, empty, "core" — is the AGPL build. */
export const isEnterprise = process.env.POLARIS_EDITION === 'ee';

/**
 * The module aliases, in the form vite and vitest both take.
 *
 * `@ee` is a directory alias rather than a wildcard because both sides expose the same
 * module names; a subpath that exists in one edition and not the other is a build failure
 * in that edition only, which is the thing this arrangement is meant to make impossible.
 */
export function aliases(): Record<string, string> {
  return {
    '~': fileURLToPath(new URL('./src', import.meta.url)),
    '@ee': fileURLToPath(new URL(isEnterprise ? '../ee/web' : './src/ee-absent', import.meta.url)),
  };
}
