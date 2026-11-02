import { globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import {
  particleBackgroundColorVar,
  particleCardBackgroundVar,
  particleCardBorderVar,
  particleCardHighlightVar,
  particleCardTextVar,
} from '../../components/particle-background/particleBackgroundTheme.css';

export const AuthLayout = style({
  minHeight: '100%',
  backgroundColor: particleBackgroundColorVar,
  color: color.Background.OnContainer,
  padding: config.space.S400,
  paddingInlineEnd: config.space.S200,
  paddingBottom: 0,
  position: 'relative',
  isolation: 'isolate',
  overflow: 'hidden',
  pointerEvents: 'none',
});

globalStyle(
  `${AuthLayout} :is(a, button, input, label, select, textarea, [role='button'], [role='menuitem'], [tabindex]:not([tabindex='-1']))`,
  {
    pointerEvents: 'auto',
  }
);

export const AuthLayoutPersistentParticle = style({
  zIndex: 1,
  backgroundColor: 'transparent',
});

export const AuthCard = style({
  position: 'relative',
  zIndex: 1,
  marginTop: '1vh',
  maxWidth: toRem(460),
  width: '100%',
  backgroundColor: particleCardBackgroundVar,
  backdropFilter: 'blur(6px) saturate(1.18)',
  WebkitBackdropFilter: 'blur(6px) saturate(1.18)',
  color: particleCardTextVar,
  borderRadius: config.radii.R400,
  boxShadow: `${config.shadow.E100}, inset 0 1px 0 ${particleCardHighlightVar}`,
  border: `${config.borderWidth.B300} solid ${particleCardBorderVar}`,
  overflow: 'hidden',
  pointerEvents: 'auto',
});

export const AuthLogo = style([
  DefaultReset,
  {
    width: toRem(26),
    height: toRem(26),
  },
]);

export const AuthHeader = style({
  padding: `0 ${config.space.S400}`,
});

export const AuthCardContent = style({
  maxWidth: toRem(402),
  width: '100%',
  margin: 'auto',
  padding: config.space.S400,
  paddingTop: config.space.S700,
  paddingBottom: toRem(44),
  gap: toRem(44),
});

export const AuthFooter = style({
  position: 'relative',
  zIndex: 1,
  padding: config.space.S200,
  paddingBottom: `calc(${config.space.S200} + env(safe-area-inset-bottom, 0px))`,
  pointerEvents: 'auto',
});
