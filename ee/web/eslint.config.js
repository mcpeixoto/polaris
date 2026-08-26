// The commercial web tree's linter config.
//
// ESLint 9 refuses to lint files above its config's directory, so `eslint src ../ee/web` from
// web/ is not available however the globs are written. A config here is what brings this tree
// under the same rules rather than leaving it as the one unlinted corner of the client —
// which is exactly the corner where a missing hook dependency would sit unnoticed, because it
// is also the code the community CI path never renders.
//
// The rules are web's, imported rather than restated. Two rule sets would drift, and the
// drift would show up as the commercial screens being held to a lower standard.
import base from '../../web/eslint.config.js';

export default [
  ...base,
  {
    // Type-aware rules need a program rooted where these files are. web's config points
    // tsconfigRootDir at web/, whose tsconfig does not include this tree.
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
