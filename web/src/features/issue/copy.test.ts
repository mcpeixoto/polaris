/**
 * The markdown link is the flavour people paste, so the exact string is the contract.
 */

import { describe, expect, it } from 'vitest';

import { titleAsLink } from './copy';

describe('titleAsLink', () => {
  it('writes the identifier and the title as one markdown link', () => {
    const link = titleAsLink('ENG-12', 'Ship the importer', 'https://polaris.test/issue/ENG-12');

    expect(link.text).toBe('[ENG-12 Ship the importer](https://polaris.test/issue/ENG-12)');
    expect(link.html).toBe(
      '<a href="https://polaris.test/issue/ENG-12">ENG-12 Ship the importer</a>',
    );
  });

  it('escapes a title that would otherwise close the anchor', () => {
    // Issue titles are user input and land in an HTML clipboard flavour. A title containing
    // a quote or a tag must paste as text, not as markup somebody else's editor executes.
    const link = titleAsLink(
      'ENG-1',
      'Fix <script> & "quotes"',
      'https://polaris.test/issue/ENG-1',
    );

    expect(link.html).toBe(
      '<a href="https://polaris.test/issue/ENG-1">ENG-1 Fix &lt;script&gt; &amp; &quot;quotes&quot;</a>',
    );
    // The markdown flavour is not escaped: it is plain text, and a reader pasting it into a
    // code block should get back exactly what the title says.
    expect(link.text).toBe('[ENG-1 Fix <script> & "quotes"](https://polaris.test/issue/ENG-1)');
  });
});
