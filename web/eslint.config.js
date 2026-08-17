// ESLint 9 flat config.
//
// Deliberately small. TypeScript already catches the class of mistake most lint rules are
// about, and a rule that fires on correct code teaches people to add
// `eslint-disable` reflexively — after which the rules that matter get disabled too.
//
// The rules kept here are the ones TypeScript cannot see: React's hook contract, and the
// two project-specific invariants that would otherwise only be caught in review.

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    // Generated output is not reviewed and not edited, so linting it can only ever
    // produce noise — and codegen emits its own blanket eslint-disable, which the linter
    // then reports as an unused directive. Excluding it is the only stable answer.
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'src/gql/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        performance: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        queueMicrotask: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        indexedDB: 'readonly',
        crypto: 'readonly',
        WebSocket: 'readonly',
        Notification: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        AbortSignal: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        KeyboardEvent: 'readonly',
        PopStateEvent: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLUListElement: 'readonly',
        MediaQueryListEvent: 'readonly',
        IDBDatabase: 'readonly',
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // A `let` assigned once but READ before that assignment — from inside a callback
      // that may fire first — genuinely cannot be `const`. Without this option the rule
      // demands a change that does not compile.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],

      // A case containing only a comment is still "empty" in intent — grouping
      // `case 'Escape': case 'Tab':` with a note explaining why they share behaviour is
      // clearer than duplicating the body, and the default rule flags it as a bug.
      'no-fallthrough': ['error', { allowEmptyCase: true }],

      // An unused parameter is often deliberate — satisfying an interface, documenting a
      // signature. An unused *variable* almost never is. The underscore prefix is the
      // conventional way to say "on purpose", so honour it.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // `any` erases exactly the guarantees the rest of the codebase is built on. `unknown`
      // plus a narrowing check is almost always what was meant, and is one line longer.
      '@typescript-eslint/no-explicit-any': 'error',

      // A floating promise is a mutation nobody is waiting on and whose rejection nobody
      // sees — in a client with an offline outbox, that is a silently dropped edit.
      // `void expr` is the explicit "yes, fire and forget" escape hatch.
      '@typescript-eslint/no-floating-promises': 'error',

      // Reading `store.foo` when `foo` is a method reference, or awaiting a non-promise,
      // are both easy to write and invisible at review.
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        // An async function passed to onClick is normal and correct in React; the rule's
        // default flags it, which produces noise rather than safety.
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },

  // Type-aware rules need the program, and building it for config files is wasted work.
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ['**/*.test.{ts,tsx}'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
      },
    },
    rules: {
      // A test that deliberately constructs a malformed value has to say so somehow, and
      // the alternative — a cast chain through unknown — is less readable, not safer.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    files: ['vite.config.ts', 'vitest.config.ts', 'eslint.config.js'],
    languageOptions: {
      globals: { process: 'readonly', __dirname: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
)
