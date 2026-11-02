import { style, styleVariants } from '@vanilla-extract/css';
import { color, config, DefaultReset, toRem } from 'folds';

export const Activity = style([
  DefaultReset,
  {
    marginTop: config.space.S100,
    marginBottom: config.space.S100,
    minWidth: 0,
  },
]);

// One full-width row per activity: no border at rest, a tint on hover, and the chevron
// pinned to the right edge so every row has the same geometry.
export const Line = style([
  DefaultReset,
  {
    display: 'flex',
    alignItems: 'center',
    gap: config.space.S200,
    width: `calc(100% + ${config.space.S200})`,
    marginInline: `calc(${config.space.S100} * -1)`,
    padding: `${toRem(3)} ${config.space.S100}`,
    border: 'none',
    borderRadius: config.radii.R300,
    background: 'none',
    color: color.Surface.OnContainer,
    font: 'inherit',
    fontSize: toRem(13),
    textAlign: 'start',
    cursor: 'pointer',
    selectors: {
      '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover },
      '&:focus-visible': {
        outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
        outlineOffset: toRem(1),
      },
    },
  },
]);

const IconTile = style({
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  width: toRem(22),
  height: toRem(22),
  borderRadius: toRem(7),
});

export const Icon = styleVariants({
  neutral: [
    IconTile,
    { backgroundColor: color.SurfaceVariant.Container, color: color.SurfaceVariant.OnContainer },
  ],
  success: [
    IconTile,
    { backgroundColor: color.Success.Container, color: color.Success.OnContainer },
  ],
  critical: [
    IconTile,
    { backgroundColor: color.Critical.Container, color: color.Critical.OnContainer },
  ],
  warning: [
    IconTile,
    { backgroundColor: color.Warning.Container, color: color.Warning.OnContainer },
  ],
});

export const Title = style({
  flexShrink: 0,
  fontWeight: config.fontWeight.W600,
  whiteSpace: 'nowrap',
});

export const Detail = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  opacity: config.opacity.P400,
});

export const Chevron = style({
  flexShrink: 0,
  marginInlineStart: 'auto',
  opacity: config.opacity.P400,
});

export const Panel = style({
  marginTop: config.space.S200,
  borderRadius: config.radii.R400,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  overflow: 'hidden',
});

// The latest output of a running call, under its activity line whether or not the panel is open. At most six
// rendered lines show, the newest at the bottom, however long a wrapped line is.
export const Output = style([
  DefaultReset,
  {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    maxHeight: '9em',
    overflow: 'hidden',
    margin: `${config.space.S100} 0 0`,
    paddingInlineStart: config.space.S300,
    borderInlineStart: `${config.borderWidth.B600} solid ${color.SurfaceVariant.ContainerLine}`,
    color: color.Surface.OnContainer,
    fontFamily: 'var(--font-mono)',
    fontSize: toRem(12),
    lineHeight: 1.5,
    opacity: config.opacity.P400,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
]);

export const OutputLabel = style({
  margin: `${config.space.S100} 0 0`,
  overflow: 'hidden',
  color: color.Surface.OnContainer,
  fontFamily: 'var(--font-mono)',
  fontSize: toRem(12),
  opacity: config.opacity.P400,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

// Rows in the panel are separated by quiet dividers, not nested boxes.
export const Row = style({
  display: 'grid',
  gridTemplateColumns: `${toRem(22)} minmax(0, 1fr)`,
  columnGap: toRem(10),
  rowGap: toRem(4),
  alignItems: 'start',
  padding: `${toRem(10)} ${toRem(14)} ${toRem(10)} ${toRem(12)}`,
  selectors: {
    '& + &': {
      borderTop: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
    },
  },
});

export const RowBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(2),
  minWidth: 0,
});

export const RowName = style({
  fontFamily: 'var(--font-mono)',
  fontSize: toRem(13),
  fontWeight: config.fontWeight.W600,
  lineHeight: toRem(22),
});

export const RowText = style({
  fontSize: toRem(13),
  minWidth: 0,
});

export const Result = style([
  DefaultReset,
  {
    display: 'block',
    width: '100%',
    padding: 0,
    border: 'none',
    background: 'none',
    color: 'inherit',
    fontFamily: 'var(--font-mono)',
    fontSize: toRem(12),
    lineHeight: 1.5,
    textAlign: 'start',
    opacity: config.opacity.P400,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    selectors: {
      '&[aria-expanded="true"]': { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
      '&:focus-visible': {
        outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
        borderRadius: config.radii.R300,
      },
    },
  },
]);
