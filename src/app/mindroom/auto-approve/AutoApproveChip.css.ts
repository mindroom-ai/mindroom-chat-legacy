import { style } from '@vanilla-extract/css';
import { color } from 'folds';
import { HeaderChip } from '../messages/ThreadApprovals.css';

// The header status chip in the warning tone, as tool calls here run without approval cards.
export const Chip = style([
  HeaderChip,
  {
    borderColor: color.Warning.ContainerLine,
    background: color.Warning.Container,
    color: color.Warning.OnContainer,
  },
]);

// As tall as the text, so the chip stays the height of the tags beside it.
export const ChipIcon = style({
  verticalAlign: 'middle',
  marginInlineEnd: '0.2rem',
  selectors: { '&&': { width: '1em', height: '1em' } },
});
