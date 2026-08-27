import type { CodegenConfig } from '@graphql-codegen/cli';

/**
 * Types for the client's GraphQL operations, generated from the one contract.
 *
 * The operations themselves are hand-written in `src/gql/operations.ts` — there are few of
 * them, and the client's real read path is the local store, not the network. What is
 * generated is the *types*: the variables each mutation takes and the shape it returns.
 *
 * That is the half that earns its keep. A field renamed in schema.graphql shows up here as
 * a TypeScript error at the call site, rather than as a runtime null the client renders as
 * an empty row.
 */
const config: CodegenConfig = {
  schema: '../schema/schema.graphql',
  // The commercial tree is scanned too, and deliberately in EVERY edition rather than only
  // when POLARIS_EDITION=ee.
  //
  // Codegen's job here is to validate documents against the one schema, and that check has
  // to run somewhere that always runs — a document only checked in the enterprise build is a
  // document whose renamed field is discovered by the release build. Running it always also
  // keeps `make generate` deterministic, which is what the "Generated code is not stale" job
  // compares against; making the output depend on an environment variable would make that
  // job fail for whoever set it.
  //
  // Only the TYPES are generated from this. No commercial code is copied into src/.
  documents: [
    'src/**/*.ts',
    'src/**/*.tsx',
    '../ee/web/**/*.ts',
    '../ee/web/**/*.tsx',
    '!src/gql/generated/**',
  ],
  ignoreNoDocuments: false,
  generates: {
    'src/gql/generated/': {
      preset: 'client',
      presetConfig: {
        // The client store owns fragment composition; masking would fight it by hiding
        // fields the store legitimately reads off the same object.
        fragmentMasking: false,
      },
      config: {
        // The schema's scalars are strings on the wire but must not be interchangeable
        // with plain strings in the client, or an issue id and a team id become the same
        // type and a transposed argument compiles.
        scalars: {
          UUID: 'string',
          Time: 'string',
          JSON: 'unknown',
        },
        useTypeImports: true,
        skipTypename: true,
        enumsAsTypes: true,
      },
    },
  },
};

export default config;
