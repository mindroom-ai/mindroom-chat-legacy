import React, { ButtonHTMLAttributes, ComponentProps, forwardRef } from 'react';
import { IconButton } from 'folds';

type ComposerIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> &
  Pick<ComponentProps<typeof IconButton>, 'size' | 'radii'> & {
    /** Marks the button as a toggle; omit for plain actions such as Attach. */
    pressed?: boolean;
  };

// The composer's glass owns the material, so its controls stay borderless:
// a raised control per button made a dozen rims and shadows compete with the text.
// A pressed toggle (bold, Markdown, the formatting bar, an open emoji board) takes
// folds' pressed fill in Primary, so its state reads at a glance instead of as a darker grey.
export const ComposerIconButton = forwardRef<HTMLButtonElement, ComposerIconButtonProps>(
  ({ pressed, ...props }, ref) => (
    <IconButton
      {...props}
      ref={ref}
      variant={pressed ? 'Primary' : 'SurfaceVariant'}
      fill="None"
      aria-pressed={pressed}
    />
  )
);
