import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import LoadingOverlay from '../src/components/ui/LoadingOverlay.jsx';
import ExportDiagnosticsNotice from '../src/components/ui/ExportDiagnosticsNotice.jsx';

it('shows the actual stage with an indeterminate bar instead of fake 15% export progress', () => {
  const html = renderToStaticMarkup(<LoadingOverlay task={{ id: 'export', label: 'Exporting', detail: 'Baking normals for tile 2, 3' }} />);
  expect(html).toContain('Baking normals for tile 2, 3');
  expect(html).toContain('loading-bar-fill indeterminate');
  expect(html).toContain('width="0"');
});
it('shows persistent export errors and diagnostics independently of notification preferences', () => {
  const html = renderToStaticMarkup(<ExportDiagnosticsNotice report={{ id: 'export-1', status: 'failed', stage: 'Packaging GLB', message: 'GPU lost', events: [] }} />);
  expect(html).toContain('role="alert"');
  expect(html).toContain('GPU lost');
  expect(html).toContain('Packaging GLB');
  expect(html).toContain('Save diagnostics');
});
