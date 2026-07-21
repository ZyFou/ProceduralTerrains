export function randomSessionSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

export function Logo({ size = 40, className = '' }) {
  return (
    <svg
      className={`landing-logo ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 18 L9 7 L13 13 L16 9 L21 18 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="17.5" cy="5.5" r="1.6" fill="currentColor" />
    </svg>
  );
}
import React from 'react';

