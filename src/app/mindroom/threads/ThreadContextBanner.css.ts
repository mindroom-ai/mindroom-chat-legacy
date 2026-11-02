import { keyframes, style, type CSSProperties } from '@vanilla-extract/css';
import { config, color } from 'folds';
import { glassFloating, glassSurface } from '../../styles/Glass.css';
import { shortViewport } from './shortViewport';

// Collapsed, the banner shrinks to a pill with back and Show details at the
// start of the row, so the messages show beside it.
export const Collapsed = style({});

// Short screens keep one row: back, title and the actions menu, which already
// offers tags, pinning and resolving. Doubled to beat single-class rules
// regardless of stylesheet order. Spread it only into styles without media
// queries of their own.
const whenCompact = (compact: CSSProperties) => ({
  '@media': { [shortViewport]: { selectors: { '&&': compact } } },
});

const BannerLayout = style({
  margin: `${config.space.S200} ${config.space.S300}`,
  padding: config.space.S300,
  borderRadius: config.radii.R400,
  flexShrink: 0,
  pointerEvents: 'auto',
  selectors: { [`&${Collapsed}`]: { width: 'fit-content', padding: config.space.S100 } },
  '@media': { [shortViewport]: { padding: config.space.S200 } },
});

export const CompactHidden = style(whenCompact({ display: 'none' }));

export const Banner = style([
  BannerLayout,
  glassSurface({ level: 'control', variant: 'SurfaceVariant' }),
  glassFloating,
]);

// Back, title and actions; narrow screens add the tags as a second row.
export const TitleRow = style({
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  alignItems: 'center',
  columnGap: config.space.S300,
  minHeight: '1.5rem',
});

// Holds the eyebrow, the approvals chip and the tags; often none of them.
export const EyebrowRow = style({
  flexShrink: 0,
  selectors: { '&:empty': { display: 'none' } },
  '@media': {
    [shortViewport]: {
      // Beside the title, the status chips keep to the room left of the thread actions.
      flexShrink: 1,
      minWidth: 0,
      selectors: { [`&:not(:has(> :not(${CompactHidden})))`]: { display: 'none' } },
    },
    // Phones show the tags in a row of their own, so here only status chips take another line.
    '(max-width: 480px)': { flexWrap: 'wrap' },
  },
});

// "Thread View" is chrome, not content: it says the same thing on every
// thread the user opens, so it shows only while the thread has no title and
// gives way to a status chip. It uses the same uppercase/12px/W500 treatment
// the sidebar category headers and the SHOW MORE pill already use for that role.
export const ViewLabel = style({
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontWeight: config.fontWeight.W500,
  whiteSpace: 'nowrap',
  selectors: { [`${EyebrowRow}:has(> [data-thread-status-chip]) > &`]: { display: 'none' } },
});

// On short screens the approvals chip that stays in view sits beside the title.
// A size container, so the byline can wrap by the room the title has: a tablet
// with the room list open leaves as little as a phone.
export const TitleColumn = style({
  containerType: 'inline-size',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  gap: 0,
  ...whenCompact({ flexDirection: 'row', alignItems: 'center', columnGap: config.space.S200 }),
});

// The tags take the room the status chips leave, clipped where they do not fit.
export const TagsRow = style({
  display: 'inline-flex',
  flex: '1 1 0',
  alignItems: 'center',
  gap: '0.3rem',
  flexWrap: 'nowrap',
  overflow: 'hidden',
});

/**
 * Desktop: tags inline on title row (hidden below).
 * Mobile (<480px): tags hidden on title row, shown in a dedicated row below.
 */
export const DesktopOnlyTags = style({
  '@media': {
    '(max-width: 480px)': {
      display: 'none',
    },
  },
});

// On short screens the title and a scheduled task share one line and truncate together; they take the room the
// status chips leave, down to a short stub.
export const SubtitleRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  marginTop: config.space.S100,
  minWidth: 0,
  flexWrap: 'wrap',
  selectors: {
    [`${EyebrowRow}:empty + &`]: { marginTop: 0 },
  },
  '@media': {
    [shortViewport]: { marginTop: 0, flexWrap: 'nowrap', flex: '1 1 0', minWidth: '4rem' },
    // Narrow screens move the tags to their own row, which can leave the
    // eyebrow row with nothing showing.
    '(max-width: 480px)': {
      selectors: {
        [`${EyebrowRow}:not(:has(> :not(${DesktopOnlyTags}))) + &`]: { marginTop: 0 },
      },
    },
  },
});

// Who resolved the thread follows the title like the schedule does; below
// the chip it made that column taller than the buttons beside it. Where the
// title column is narrow (phones, tablets with the room list) the byline would
// squeeze the title to an ellipsis, so it takes a line of its own there.
const narrowTitle = '(max-width: 26rem)';
export const ResolutionByline = style({
  display: 'inline-flex',
  minWidth: 0,
  flexShrink: 0,
  '@container': { [narrowTitle]: { flexBasis: '100%' } },
});

// The separator only makes sense beside the title.
export const ResolutionBylineDot = style({
  '@container': { [narrowTitle]: { display: 'none' } },
});

export const ResolverName = style({
  minWidth: 0,
  maxWidth: '10rem',
  '@container': { [narrowTitle]: { maxWidth: 'none' } },
});

// Resolved, the check fills like a set pin: solid green, as the chip was.
export const ResolvedButton = style({
  backgroundColor: color.Success.Main,
  color: color.Success.OnMain,
  selectors: {
    '&:hover, &:focus-visible': { backgroundColor: color.Success.MainHover },
    '&:active': { backgroundColor: color.Success.MainActive },
  },
});

// The grey this used to hardcode (rgba(128,128,128,0.2)) is the same slab in
// all five themes, so it read as a hole in butter and as a smudge in midnight.
// On the container tokens it tracks the tag pills it sits next to.
export const OverflowChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: '0.65rem',
  fontWeight: config.fontWeight.W500,
  padding: '0.1rem 0.4rem',
  borderRadius: config.radii.R300,
  background: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  cursor: 'default',
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
});

export const MobileOnlyTags = style({
  display: 'none',
  gridColumn: '2 / -1',
  '@media': {
    '(max-width: 480px)': {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '0.3rem',
      marginTop: config.space.S100,
    },
  },
});

// The thread title is the one thing in this bar that differs per thread, so
// it carries the weight the "Thread View" eyebrow used to take.
export const SummaryText = style({
  display: 'block',
  fontWeight: config.fontWeight.W500,
  minWidth: 0,
  // Fills the row only as far as the title is long, so a schedule or a
  // byline follows it instead of the far end of the row.
  maxWidth: 'max-content',
  flex: '1 1 0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...whenCompact({ flexBasis: 'auto' }),
});

const SummaryChangedTint = keyframes({
  from: {
    backgroundColor: color.Primary.Container,
    boxShadow: `0 0 0 ${config.space.S100} ${color.Primary.Container}`,
  },
  to: {
    backgroundColor: 'transparent',
    boxShadow: `0 0 0 ${config.space.S100} transparent`,
  },
});

export const SummaryTextChanged = style({
  borderRadius: config.radii.R300,
  animation: `${SummaryChangedTint} 2.4s ease-out`,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
    },
  },
});

export const ScheduledWrap = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
  flexShrink: 0,
  ...whenCompact({ flexShrink: 1 }),
});

export const MetadataDot = style({
  flexShrink: 0,
});

export const ScheduledIndicator = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  ...whenCompact({ flexShrink: 1 }),
});

export const BannerResolved = style([
  BannerLayout,
  glassSurface({ level: 'control', variant: 'Success' }),
  glassFloating,
  { color: color.Success.OnContainer },
]);

export const BannerDisabled = style({
  opacity: 0.6,
  pointerEvents: 'none',
});

export const TagPickerInputContainer = style({
  borderBottom: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  padding: `0 ${config.space.S100}`,
});

export const TagPickerInput = style({
  width: '100%',
  display: 'block',
  padding: `${config.space.S200} ${config.space.S300}`,
  border: 'none',
  outline: 'none',
  font: 'inherit',
  fontSize: '0.8rem',
  lineHeight: 1.4,
  background: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  caretColor: color.SurfaceVariant.OnContainer,
  selectors: {
    '&::placeholder': {
      color: color.SurfaceVariant.OnContainer,
      opacity: '0.5',
    },
    '&:focus::placeholder': {
      opacity: '0',
    },
  },
});
