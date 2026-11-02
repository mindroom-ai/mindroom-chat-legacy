import { JoinRule } from 'matrix-js-sdk';
import { AvatarFallback, AvatarImage, Icon, Icons, color } from 'folds';
import React, {
  ComponentProps,
  ReactEventHandler,
  ReactNode,
  forwardRef,
  useEffect,
  useState,
} from 'react';
import * as css from './RoomAvatar.css';
import { getRoomIconSrc } from '../../utils/room';
import colorMXID from '../../../util/colorMXID';

type RoomAvatarProps = {
  roomId: string;
  src?: string;
  alt?: string;
  renderFallback: () => ReactNode;
};
export function RoomAvatar({ roomId, src, alt, renderFallback }: RoomAvatarProps) {
  // Remember which URL failed: media URLs change once authentication is available, and the new one must load.
  const [failedSrc, setFailedSrc] = useState<string>();

  useEffect(() => setFailedSrc(undefined), [src]);

  const handleLoad: ReactEventHandler<HTMLImageElement> = (evt) => {
    evt.currentTarget.setAttribute('data-image-loaded', 'true');
  };

  if (!src || failedSrc === src) {
    return (
      <AvatarFallback
        style={{ backgroundColor: colorMXID(roomId ?? ''), color: color.Surface.Container }}
        className={css.RoomAvatar}
      >
        {renderFallback()}
      </AvatarFallback>
    );
  }

  return (
    <AvatarImage
      className={css.RoomAvatar}
      src={src}
      alt={alt}
      onError={() => setFailedSrc(src)}
      onLoad={handleLoad}
      draggable={false}
    />
  );
}

export const RoomIcon = forwardRef<
  SVGSVGElement,
  Omit<ComponentProps<typeof Icon>, 'src'> & {
    joinRule?: JoinRule;
    roomType?: string;
  }
>(({ joinRule, roomType, ...props }, ref) => (
  <Icon src={getRoomIconSrc(Icons, roomType, joinRule)} {...props} ref={ref} />
));
