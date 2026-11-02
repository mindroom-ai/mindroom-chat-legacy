import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

export { Header, Panel } from '../sidebar/SidePanel.css';

export const TitleGroup = style({
  flex: '1 1 auto',
  minWidth: 0,
});

export const Controls = style({
  flex: '0 0 auto',
});

export const Title = style({
  flex: '1 1 auto',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
});

export const Frame = style({
  backgroundColor: color.Background.Container,
  border: 'none',
  display: 'block',
  flex: '1 1 auto',
  minHeight: 0,
  width: '100%',
});

export const Footer = style({
  borderTop: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  display: 'flex',
  flexDirection: 'column',
  flex: '0 0 auto',
  gap: config.space.S200,
  minHeight: '2.5rem',
  alignItems: 'flex-start',
  padding: `${config.space.S200} ${config.space.S300}`,
  paddingBottom: `calc(${config.space.S200} + env(safe-area-inset-bottom, 0px))`,
});

export const Error = style({
  color: color.Critical.Main,
});

export const Version = style({
  whiteSpace: 'nowrap',
});

export const Notice = style({
  alignItems: 'center',
  backgroundColor: color.SurfaceVariant.Container,
  borderBottom: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  display: 'flex',
  flex: '0 0 auto',
  gap: config.space.S200,
  justifyContent: 'space-between',
  padding: `${config.space.S200} ${config.space.S300}`,
});

export const Staged = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  width: '100%',
});

export const Data = style({
  fontFamily: 'monospace',
  fontSize: '0.75rem',
  maxHeight: '10rem',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});
