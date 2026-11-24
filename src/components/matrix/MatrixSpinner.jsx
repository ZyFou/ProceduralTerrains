import React, { forwardRef } from 'react';
import './matrix-button.js';

/**
 * React wrapper for the <matrix-spinner> Web Component: the LED dot-matrix
 * ring from <matrix-button>, on its own and always animating.
 *
 *   <MatrixSpinner size={14} minimal />                    // decorative
 *   <MatrixSpinner size="md" label="Compiling shaders" />  // announced as an image
 *
 * `size` takes xs | sm | md | lg or a pixel number. Without `label` the
 * spinner is aria-hidden, so put readable status text next to it.
 */
const flag = (value) => (value ? '' : undefined);

const MatrixSpinner = forwardRef(function MatrixSpinner(
  { size, color, speed, minimal = false, paused = false, label, className, ...rest },
  ref,
) {
  return (
    <matrix-spinner
      ref={ref}
      // React 18 passes custom-element props through verbatim: `class`, not `className`.
      class={className}
      size={size == null ? undefined : String(size)}
      color={color}
      speed={speed == null ? undefined : String(speed)}
      minimal={flag(minimal)}
      paused={flag(paused)}
      label={label || undefined}
      {...rest}
    />
  );
});

export default MatrixSpinner;
export { MatrixSpinner };
