#!/usr/bin/env node
// Every GraphQL document the iOS client sends must be valid against schema/schema.graphql.
//
// The iOS client writes its operations as Swift string literals rather than generating them.
// That is the right trade for eleven operations — a codegen step inside an Xcode build costs
// more than it returns — but it removes the one thing codegen gives you for free: the
// documents and the schema cannot drift apart silently.
//
// And they drift in the worst possible way. A renamed field or a changed argument type still
// compiles, still ships, and fails at runtime as a GraphQL error inside a 200 response — on a
// device, in front of a user, on a screen that just says something went wrong. No Swift test
// catches it, because the string is opaque to the type checker. No web test catches it,
// because the web client generates its own documents from the same schema and simply moves
// on. The iOS client is the only consumer that can be left behind, and it is the only one
// that cannot be fixed by redeploying.
//
// So the check is: parse each document, validate it against the schema, fail on any error.
//
// Unlike the other lints here this one uses a real parser rather than brace-matched text.
// That is not inconsistency — those lints check *conventions*, which have no grammar and
// where a parser would rot. This one checks a document against a schema, which is exactly
// what a GraphQL parser is for, and both inputs are already in the repository.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// `graphql` lives under web/, not at the workspace root — pnpm does not hoist it. Imported by
// explicit path so this script does not need a root-level dependency of its own.
const graphqlEntry = pathToFileURL(resolve(repoRoot, 'web/node_modules/graphql/index.js')).href;
let graphql;
try {
  graphql = await import(graphqlEntry);
} catch {
  console.error('lint-ios-graphql: cannot load graphql from web/node_modules.');
  console.error('  Run `pnpm install` first.');
  process.exit(1);
}
const { buildSchema, parse, validate } = graphql;

const SCHEMA = resolve(repoRoot, 'schema/schema.graphql');
const DOCUMENTS = resolve(
  repoRoot,
  'ios/PolarisCore/Sources/PolarisCore/Networking/GraphQLDocuments.swift'
);

const source = readFileSync(DOCUMENTS, 'utf8');

// `static let name = """ … """`. The documents are the only multi-line literals in the file,
// which is itself deliberate: they are kept in one file so the whole wire surface can be read
// at once, and so this lint has exactly one place to look.
const literal = /static let (\w+)\s*=\s*"""\n(.*?)\n\s*"""/gs;
const documents = new Map();
for (const [, name, body] of source.matchAll(literal)) {
  documents.set(name, body);
}

if (documents.size === 0) {
  console.error(`lint-ios-graphql: no documents found in ${DOCUMENTS}.`);
  console.error('  The literal format changed, and this lint is now checking nothing.');
  process.exit(1);
}

// The Swift file composes the shared fragment in by interpolation. Resolve it the same way so
// what is validated is what is actually sent.
const fragment = documents.get('issueFields') ?? '';
documents.delete('issueFields');

const schema = buildSchema(readFileSync(SCHEMA, 'utf8'));

let failed = 0;
for (const [name, raw] of documents) {
  const body = raw.replaceAll('\\(issueFields)', fragment);
  try {
    const errors = validate(schema, parse(body));
    if (errors.length > 0) {
      failed++;
      console.error(`✗ ${name}`);
      for (const error of errors) console.error(`    ${error.message}`);
    }
  } catch (error) {
    failed++;
    console.error(`✗ ${name}: ${error.message}`);
  }
}

if (failed > 0) {
  console.error(`\nlint-ios-graphql: ${failed} document(s) do not match schema/schema.graphql.`);
  process.exit(1);
}

console.log(`lint-ios-graphql: ${documents.size} documents match the schema.`);
