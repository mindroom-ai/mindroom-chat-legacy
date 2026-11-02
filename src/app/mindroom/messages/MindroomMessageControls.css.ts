import { style } from '@vanilla-extract/css';
import { DefaultReset, toRem } from 'folds';

export const AiRunInfoButton = style([
  DefaultReset,
  {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: toRem(16),
    height: toRem(16),
    border: 0,
    borderRadius: toRem(999),
    padding: 0,
    color: 'inherit',
    opacity: 0.75,
    cursor: 'pointer',
    selectors: {
      '&:hover': {
        opacity: 1,
      },
      '&:focus-visible': {
        opacity: 1,
        outline: `${toRem(2)} solid currentColor`,
        outlineOffset: toRem(1),
      },
    },
  },
]);

export const MenuItemText = style({
  flexGrow: 1,
});

// The header stays inside the scroll viewport, as in the approval review.
export const ReplyDetailsScroll = style({
  maxHeight: 'min(80dvh, calc(100dvh - 24px))',
});
