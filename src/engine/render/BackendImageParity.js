function assertComparable(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) {
    throw new Error('Backend images must be non-empty buffers of equal length');
  }
}

export function imageRmse(a, b) {
  assertComparable(a, b);
  let squared = 0;
  for (let i = 0; i < a.length; i++) {
    const delta = (a[i] - b[i]) / 255;
    squared += delta * delta;
  }
  return Math.sqrt(squared / a.length);
}

// Global SSIM is stable for automated backend goldens and intentionally does
// not hide local regressions with window overlap. Alpha participates when it is
// present in the supplied buffers.
export function imageSsim(a, b) {
  assertComparable(a, b);
  const n = a.length;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i] / 255;
    meanB += b[i] / 255;
  }
  meanA /= n;
  meanB /= n;
  let varianceA = 0;
  let varianceB = 0;
  let covariance = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] / 255 - meanA;
    const db = b[i] / 255 - meanB;
    varianceA += da * da;
    varianceB += db * db;
    covariance += da * db;
  }
  const divisor = Math.max(1, n - 1);
  varianceA /= divisor;
  varianceB /= divisor;
  covariance /= divisor;
  const c1 = 0.01 ** 2;
  const c2 = 0.03 ** 2;
  return ((2 * meanA * meanB + c1) * (2 * covariance + c2))
    / ((meanA ** 2 + meanB ** 2 + c1) * (varianceA + varianceB + c2));
}

export const DEFAULT_BACKEND_PARITY_THRESHOLDS = Object.freeze({
  minimumSsim: 0.985,
  maximumRmse: 0.035,
});

export function compareBackendImages(a, b, thresholds = DEFAULT_BACKEND_PARITY_THRESHOLDS) {
  const ssim = imageSsim(a, b);
  const rmse = imageRmse(a, b);
  return {
    pass: ssim >= thresholds.minimumSsim && rmse <= thresholds.maximumRmse,
    ssim,
    rmse,
    thresholds,
  };
}

