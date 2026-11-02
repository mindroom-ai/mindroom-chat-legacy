import { style } from '@vanilla-extract/css';
import { color, config, DefaultReset, toRem } from 'folds';

// Tool names in the activity line look like inline code in the body.
export { Code as ActivityCode } from '../../styles/CustomHtml.css';

// Reasoning sits above most agent replies, so it stays a quiet line of text, not a panel.
export const Reasoning = style({
  marginBottom: config.space.S100,
  minWidth: 0,
  maxWidth: '100%',
});

export const Toggle = style([
  DefaultReset,
  {
    display: 'flex',
    alignItems: 'center',
    gap: config.space.S100,
    width: 'fit-content',
    maxWidth: '100%',
    minHeight: toRem(24),
    paddingInline: `0 ${config.space.S100}`,
    border: 'none',
    borderRadius: config.radii.R300,
    background: 'transparent',
    color: color.Surface.OnContainer,
    opacity: config.opacity.P400,
    cursor: 'pointer',
    fontSize: config.fontSize.T200,
    lineHeight: config.lineHeight.T200,
    selectors: {
      '&:hover, &:focus-visible, &[aria-expanded="true"]': { opacity: 1 },
      '&:focus-visible': {
        outline: `2px solid ${color.Primary.Main}`,
        outlineOffset: '-2px',
      },
    },
  },
]);

export const Label = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const Body = style({
  marginTop: config.space.S100,
  paddingInlineStart: config.space.S300,
  borderInlineStart: `${toRem(2)} solid ${color.SurfaceVariant.ContainerLine}`,
  fontSize: config.fontSize.T300,
  lineHeight: config.lineHeight.T300,
});
