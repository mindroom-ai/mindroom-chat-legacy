import { style } from '@vanilla-extract/css';
import { color, config, DefaultReset, toRem } from 'folds';

/** Right-hand conversation panel: fills its resizable column on desktop, full screen on narrow viewports. */
export const Panel = style([
  DefaultReset,
  {
    backgroundColor: color.Surface.Container,
    color: color.Surface.OnContainer,
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    width: '100%',
    minWidth: 0,
    position: 'relative',
    '@media': {
      [`screen and (max-width: ${toRem(750)})`]: {
        bottom: 0,
        flex: 'none',
        left: 0,
        position: 'fixed',
        right: 0,
        top: 0,
        zIndex: 20,
      },
    },
  },
]);

export const Header = style({
  alignItems: 'center',
  borderBottom: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  display: 'flex',
  flex: '0 0 auto',
  gap: config.space.S200,
  justifyContent: 'space-between',
  minHeight: toRem(56),
  padding: `${config.space.S200} ${config.space.S300}`,
  paddingTop: `calc(${config.space.S200} + env(safe-area-inset-top, 0px))`,
});
