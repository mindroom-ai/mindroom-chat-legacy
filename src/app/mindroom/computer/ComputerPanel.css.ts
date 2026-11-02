import { createContainer, globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { Header as SidePanelHeader, Panel as SidePanelPanel } from '../sidebar/SidePanel.css';

// The panel's own size picks the layout, so it follows the window, Expand and the resize handle.
// Only `PanelWithScreen` names the container, so without a screen every rule below is off.
const panel = createContainer('computerPanel');

// From about the screen's 16:10 shape, the controls below the screen cost it more height than a
// column beside it costs in width, so the screen takes the full height. Measured, the crossover
// is about 3:2. A panel under 28rem tall, a phone in landscape, is too short for the screen's
// 15rem minimum and the controls below it once the Agent select shows, so 5:4 is enough there.
const sideBySide = `${panel} (min-aspect-ratio: 3/2) or ((max-height: 28rem) and (min-aspect-ratio: 5/4))`;

// As wide as the header needs, wider on a big panel, where the screen is limited by height.
const sideColumnWidth = `minmax(min-content, clamp(${toRem(176)}, 22cqw, ${toRem(256)}))`;

// The panel sizes from its column or, on phones, the viewport, never from its content, so it can
// be a size container without collapsing. `#root` already pads the top, left and right safe areas
// around the panel in normal flow. The full-screen panel outside that padding is for viewports up
// to 750 px wide, and no iPhone that narrow in landscape has a notch.
export const Panel = style([
  SidePanelPanel,
  {
    containerType: 'size',
  },
]);

// While the screen or its connecting spinner shows. With nothing to show beside the controls,
// they stack across the panel instead of leaving most of it empty.
export const PanelWithScreen = style({
  containerName: panel,
});

export const Layout = style({
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
  minHeight: 0,
  '@container': {
    [sideBySide]: {
      display: 'grid',
      gridTemplateAreas: '"screen header" "screen agent" "screen details"',
      gridTemplateColumns: `minmax(0, 1fr) ${sideColumnWidth}`,
      gridTemplateRows: 'auto auto minmax(0, 1fr)',
    },
  },
});

export const Header = style([
  SidePanelHeader,
  {
    '@container': {
      [sideBySide]: { gridArea: 'header' },
    },
  },
]);

export const Body = style({
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
  gap: config.space.S300,
  minHeight: 0,
  padding: config.space.S300,
  '@container': {
    // Its children join the panel's grid: the screen on one side, the controls on the other.
    [sideBySide]: { display: 'contents' },
  },
});

export const AgentField = style({
  '@container': {
    [sideBySide]: {
      gridArea: 'agent',
      padding: `${config.space.S300} ${config.space.S300} 0`,
    },
  },
});

// The screen, or the spinner while it connects: the full height. `#root` pads no bottom inset, so
// the screen keeps clear of the home indicator and its swipe, which would cover the touchpad.
export const ScreenArea = style({
  '@container': {
    [sideBySide]: {
      gridArea: 'screen',
      margin: [
        config.space.S300,
        '0',
        `max(${config.space.S300}, env(safe-area-inset-bottom, 0px))`,
        config.space.S300,
      ].join(' '),
    },
  },
});

export const ScreenFrame = style([
  ScreenArea,
  {
    alignItems: 'center',
    background: '#111',
    borderRadius: config.radii.R300,
    display: 'flex',
    flex: '1 1 auto',
    justifyContent: 'center',
    minHeight: toRem(240),
    overflow: 'hidden',
    '@container': {
      [sideBySide]: { minHeight: 0 },
    },
  },
]);

export const Screen = style({
  alignItems: 'center',
  display: 'flex',
  height: '100%',
  justifyContent: 'center',
  minHeight: 0,
  outline: 'none',
  position: 'relative',
  width: '100%',
  selectors: {
    '&:focus-visible': {
      boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${color.Primary.Main}`,
    },
  },
});

// While in control, touches drive the touchpad, so the browser neither scrolls nor zooms.
export const ScreenInControl = style({
  touchAction: 'none',
});

// The software keyboard's textarea: focusable, so the keyboard opens, but neither seen nor in
// the way of a touch. Inside the screen, where focusing it scrolls nothing away. At 16px, iOS
// does not zoom in when it takes focus.
export const KeyboardInput = style({
  caretColor: 'transparent',
  fontSize: '16px',
  height: '1px',
  left: 0,
  margin: 0,
  opacity: 0,
  padding: 0,
  pointerEvents: 'none',
  position: 'absolute',
  top: 0,
  width: '1px',
});

globalStyle(`${Screen} canvas`, {
  maxHeight: '100%',
  maxWidth: '100%',
});

// Status, notices and actions: below the screen, or the rest of the side column, which scrolls
// on its own when they do not fit.
export const Details = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S300,
  '@container': {
    [sideBySide]: {
      gridArea: 'details',
      minHeight: 0,
      overflowWrap: 'anywhere',
      overflowY: 'auto',
      padding: config.space.S300,
    },
  },
});

export const Status = style({
  color: color.Surface.OnContainer,
});

export const Error = style({
  color: color.Critical.Main,
});

export const Actions = style({
  display: 'flex',
  flex: '0 0 auto',
  flexWrap: 'wrap',
  gap: config.space.S200,
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
});

export const AgentSelect = style({
  background: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
  color: color.SurfaceVariant.OnContainer,
  font: 'inherit',
  maxWidth: '100%',
  padding: `${config.space.S200} ${config.space.S300}`,
  '@container': {
    // A long agent name fills the column instead of widening it.
    [sideBySide]: { width: '100%' },
  },
});
