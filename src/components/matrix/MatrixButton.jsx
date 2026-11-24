import React, { forwardRef } from 'react';
import './matrix-button.js';

/**
 * React wrapper for the <matrix-button> Web Component.
 *
 * React 18 stringifies props on custom elements, so `loading={false}` would
 * become `loading="false"` — a present attribute, i.e. still loading. Boolean
 * props are mapped to "present or absent" here instead.
 *
 *   <MatrixButton loading={busy} loadingLabel="Exporting…" onClick={doExport}>
 *     Export terrain
 *   </MatrixButton>
 */
const flag = (value) => (value ? '' : undefined);

const MatrixButton = forwardRef(function MatrixButton(
  { loading = false, loadingLabel, color, theme = 'dark', size, speed, block = false, disabled = false, selected = false, className, children, ...rest },
  ref,
) {
  return (
    <matrix-button
      ref={ref}
      // React 18 passes custom-element props through verbatim, so `className`
      // would land as a literal "classname" attribute; `class` is required.
      class={className}
      loading={flag(loading)}
      loading-label={loadingLabel}
      color={color}
      theme={theme}
      size={size}
      speed={speed}
      block={flag(block)}
      disabled={flag(disabled)}
      selected={flag(selected)}
      {...rest}
    >
      {children}
    </matrix-button>
  );
});

export default MatrixButton;
export { MatrixButton };
