import { style, globalStyle, keyframes } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { glassFloating, glassSurface } from '../../styles/Glass.css';
import * as disclosure from './MessageDisclosure.css';

export const Bar = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  glassFloating,
  {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 12px',
    margin: `0 ${config.space.S400} ${config.space.S200}`,
    borderRadius: config.radii.R400,
    color: color.SurfaceVariant.OnContainer,
    flexShrink: 0,
  },
]);
export const BarTitle = style({ fontWeight: config.fontWeight.W600 });
export const BarDetail = style({
  minWidth: 0,
  // Shrink the tool list before the waiting text wraps.
  flexShrink: 1000,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  opacity: 0.75,
  '@media': { '(max-width: 599px)': { display: 'none' } },
});
export const BarStatus = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
  fontSize: '0.875rem',
});
export const ReviewButton = style({
  position: 'relative',
  flexShrink: 0,
  overflow: 'visible',
});
export const ReviewButtonPending = style({
  boxShadow: `0 0 0 1px ${color.Warning.Main}, 0 0 8px 1px color-mix(in srgb, ${color.Warning.Main} 20%, transparent)`,
});
const reviewPulse = keyframes({
  '0%, 100%': { opacity: 0 },
  '50%': { opacity: 0.6 },
});
export const ReviewPulse = style({
  position: 'absolute',
  inset: 0,
  borderRadius: 'inherit',
  pointerEvents: 'none',
  boxShadow: `0 0 12px 3px ${color.Warning.Main}`,
  opacity: 0,
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      animation: `${reviewPulse} 2s ease-in-out 2`,
    },
  },
});
export const Chip = style({
  border: `1px solid ${color.Surface.ContainerLine}`,
  borderRadius: 16,
  background: color.SurfaceVariant.Container,
  color: 'inherit',
  padding: '5px 10px',
  cursor: 'pointer',
  fontSize: 12,
  whiteSpace: 'nowrap',
});
// A thread header status chip, sized like the tags beside it; in a header too narrow for it, it ends in an ellipsis.
export const HeaderChip = style([
  Chip,
  {
    // The tags' padding, less the border they do not have.
    padding: 'calc(0.1rem - 1px) calc(0.4rem - 1px)',
    borderRadius: '0.5rem',
    fontSize: '0.65rem',
    fontWeight: 500,
    lineHeight: 1.4,
    minWidth: 0,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
]);
export const Receipt = style([
  disclosure.Surface,
  { selectors: { '&:not(:first-child)': { marginBlockStart: config.space.S100 } } },
]);
export const ReceiptTool = style([
  disclosure.Label,
  {
    fontFamily: 'var(--font-mono)',
    selectors: {
      'details[open] > summary &': { whiteSpace: 'normal', overflowWrap: 'anywhere' },
    },
  },
]);
export const ReceiptBody = style([disclosure.Body, { fontSize: 13, overflowWrap: 'anywhere' }]);
globalStyle(`${ReceiptBody} p`, { margin: '0 0 6px' });
export const Stack = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });
export const HistoryBody = style([Stack, { gap: 0, padding: '0 4px' }]);
// The activity panel owns the surface; receipts inside it stay flat and unfiltered.
globalStyle(`${HistoryBody} > ${Receipt}${Receipt}`, {
  width: '100%',
  maxWidth: '100%',
  marginBlockStart: 0,
  background: 'transparent',
  border: 0,
  borderRadius: 0,
  boxShadow: 'none',
  backdropFilter: 'none',
  WebkitBackdropFilter: 'none',
});
globalStyle(`${HistoryBody} > ${Receipt}::before`, { display: 'none' });
globalStyle(`${HistoryBody} > ${Receipt}:not(:last-child)`, {
  borderBottom: `1px solid ${color.Surface.ContainerLine}`,
});
export const DialogScroll = style({
  maxHeight: 'min(80dvh, calc(100dvh - 24px))',
});
export const DialogHeading = style({ minWidth: 0, lineHeight: 1.25 });
export const DialogBody = style({
  padding: config.space.S400,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
});
export const Group = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {
    flexShrink: 0,
    borderRadius: config.radii.R400,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minWidth: 0,
    overflowWrap: 'anywhere',
    color: color.SurfaceVariant.OnContainer,
  },
]);
export const Actions = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });

export const Call = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '8px 0',
  borderBottom: `1px solid ${color.Surface.ContainerLine}`,
});

export {
  Header as ReceiptHeader,
  Label as ReceiptLabel,
  Meta as ReceiptMeta,
  Chevron as ReceiptChevron,
} from './MessageDisclosure.css';

// A group inside the glass review dialog: the dialog owns the glass, sections are divided.
export const Section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minWidth: 0,
  padding: `${config.space.S300} 0`,
  overflowWrap: 'anywhere',
  selectors: {
    '& + &': { borderTop: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}` },
    '&:first-child': { paddingTop: 0 },
  },
});
export const SectionHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
});
export const SectionIcon = style({
  width: 28,
  height: 28,
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  borderRadius: config.radii.R300,
  backgroundColor: color.Primary.Container,
  color: color.Primary.OnContainer,
});
export const SectionTitle = style({
  flexShrink: 0,
  fontSize: '0.9375rem',
  fontWeight: config.fontWeight.W600,
  whiteSpace: 'nowrap',
});
// The raw tool name gives way first when the header is narrow.
export const SectionTool = style({
  minWidth: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: '0.75rem',
  opacity: config.opacity.P400,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
// Details line up with the title, past the icon tile; phones use the full width.
export const SectionBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minWidth: 0,
  paddingInlineStart: 38,
  '@media': { '(max-width: 599px)': { paddingInlineStart: 0 } },
});
export const SectionCount = style({ opacity: config.opacity.P400, whiteSpace: 'nowrap' });
export const SectionMeta = style({ opacity: config.opacity.P400 });
export const StatusChip = style({
  marginInlineStart: 'auto',
  flexShrink: 0,
  padding: '2px 10px',
  borderRadius: config.radii.Pill,
  fontSize: 12,
  fontWeight: config.fontWeight.W600,
  whiteSpace: 'nowrap',
  backgroundColor: color.SurfaceVariant.ContainerActive,
  color: color.SurfaceVariant.OnContainer,
});
export const StatusChipAttention = style({
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
});
export const StatusChipDone = style({
  backgroundColor: color.Success.Container,
  color: color.Success.OnContainer,
});
export const Durations = style({ display: 'flex', flexDirection: 'column', gap: 6 });
export const DurationRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S200,
  color: color.Surface.OnContainer,
});
// Solid segments: on a glass sheet, see-through buttons read as disabled.
export const Segmented = style({
  display: 'inline-flex',
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  overflow: 'hidden',
});
export const Segment = style({
  border: 0,
  padding: '5px 11px',
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  font: 'inherit',
  fontSize: 13,
  fontWeight: config.fontWeight.W600,
  cursor: 'pointer',
  selectors: {
    '& + &': {
      borderInlineStart: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
    },
    '&:hover:not(:disabled)': {
      backgroundColor: color.Primary.Container,
      color: color.Primary.OnContainer,
    },
    '&:focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: -2 },
    '&:disabled': { cursor: 'not-allowed', opacity: config.opacity.Disabled },
  },
});
export const SingleCall = style({ display: 'flex', flexDirection: 'column', gap: 10 });
export const CallsToggle = style({ alignSelf: 'flex-start' });
export const DenyRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S200,
});
// The reason field fills the row; the confirm and cancel buttons wrap below when narrow.
globalStyle(`${DenyRow} > :first-child`, { flex: '1 1 12rem', minWidth: 0 });
