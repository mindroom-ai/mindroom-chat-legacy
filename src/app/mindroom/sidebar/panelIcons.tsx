import React from 'react';
import type { IconSrc } from 'folds';

export const ExpandIcon: IconSrc = () => (
  <path
    d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);
export const ShrinkIcon: IconSrc = () => (
  <path
    d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);
