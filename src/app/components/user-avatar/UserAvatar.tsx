import { AvatarFallback, AvatarImage, color } from 'folds';
import React, { ReactEventHandler, ReactNode, useEffect, useState } from 'react';
import classNames from 'classnames';
import * as css from './UserAvatar.css';
import colorMXID from '../../../util/colorMXID';

type UserAvatarProps = {
  className?: string;
  userId: string;
  src?: string;
  alt?: string;
  renderFallback: () => ReactNode;
};
export function UserAvatar({ className, userId, src, alt, renderFallback }: UserAvatarProps) {
  // Remember which URL failed: media URLs change once authentication is available, and the new one must load.
  const [failedSrc, setFailedSrc] = useState<string>();

  useEffect(() => setFailedSrc(undefined), [src]);

  const handleLoad: ReactEventHandler<HTMLImageElement> = (evt) => {
    evt.currentTarget.setAttribute('data-image-loaded', 'true');
  };

  if (!src || failedSrc === src) {
    return (
      <AvatarFallback
        style={{ backgroundColor: colorMXID(userId), color: color.Surface.Container }}
        className={classNames(css.UserAvatar, className)}
      >
        {renderFallback()}
      </AvatarFallback>
    );
  }

  return (
    <AvatarImage
      className={classNames(css.UserAvatar, className)}
      src={src}
      alt={alt}
      onError={() => setFailedSrc(src)}
      onLoad={handleLoad}
      draggable={false}
    />
  );
}
