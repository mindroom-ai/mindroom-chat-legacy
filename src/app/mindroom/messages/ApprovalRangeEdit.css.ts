import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// The table sits inside an approval surface, which owns the glass.
export const RangeEdit = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  minWidth: 0,
});

export const Header = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: `${config.space.S100} ${config.space.S300}`,
});

export const Target = style({
  fontFamily: 'var(--font-mono)',
  overflowWrap: 'anywhere',
});

export const Links = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: config.space.S300,
  fontSize: toRem(13),
});

// The workbook's host, so a reviewer sees where the links lead before opening them.
export const Host = style({
  opacity: config.opacity.P400,
  overflowWrap: 'anywhere',
});

export const Scroll = style({
  maxHeight: toRem(320),
  overflow: 'auto',
});

export const Table = style({
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: toRem(13),
  lineHeight: 1.5,
});

globalStyle(`${Table} th, ${Table} td`, {
  padding: `${config.space.S100} ${config.space.S200}`,
  textAlign: 'start',
  verticalAlign: 'top',
  borderBottom: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

globalStyle(`${Table} thead th`, {
  fontWeight: config.fontWeight.W500,
  opacity: config.opacity.P400,
});

export const Cell = style({
  fontFamily: 'var(--font-mono)',
  fontSize: toRem(12),
  fontWeight: config.fontWeight.W400,
  whiteSpace: 'nowrap',
});

export const Value = style({
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

export const Before = style({
  opacity: config.opacity.P400,
});

export const Muted = style({
  fontStyle: 'italic',
  opacity: config.opacity.P400,
});

export const Format = style({
  display: 'block',
  fontSize: toRem(12),
  opacity: config.opacity.P400,
});
