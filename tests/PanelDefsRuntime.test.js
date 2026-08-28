import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('panel definitions module runtime', () => {
  it('initializes React before evaluating top-level JSX icon definitions', () => {
    const source = readFileSync(new URL('../src/components/panels/defs.jsx', import.meta.url), 'utf8');
    const reactImport = source.indexOf("import React from 'react'");
    const firstJsx = source.indexOf('<svg');
    expect(reactImport).toBeGreaterThanOrEqual(0);
    expect(firstJsx).toBeGreaterThan(reactImport);
  });
});
