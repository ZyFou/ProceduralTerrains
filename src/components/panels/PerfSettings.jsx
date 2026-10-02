import React from 'react';
import QualitySettingsContent from './QualitySettingsContent.jsx';

export * from './QualitySettingsContent.jsx';

// Each independently testable renderer feature owns its controls. The quality
// editor is preserved verbatim and still supplies its named surface exports.
const features = Object.entries(import.meta.glob('./perf-features/*.jsx', {
  eager: true,
  import: 'default',
})).sort(([a], [b]) => a.localeCompare(b));

export default function PerfSettings(props) {
  if (!props.perf) return null;
  return <>
    {features.map(([path, Feature]) => <Feature key={path} {...props} />)}
    <QualitySettingsContent {...props} />
  </>;
}
