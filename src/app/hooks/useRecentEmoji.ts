import { useEffect, useState } from 'react';
import { ClientEvent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { getRecentEmojis } from '../plugins/recent-emoji';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { IEmoji } from '../plugins/emoji';
import { ImagePack, PackImageReader } from '../plugins/custom-emoji';

export const useRecentEmoji = (
  mx: MatrixClient,
  limit?: number,
  packs?: ImagePack[]
): Array<IEmoji | PackImageReader> => {
  const [recentEmoji, setRecentEmoji] = useState(() => getRecentEmojis(mx, limit, packs));

  useEffect(() => {
    // The packs resolve the custom emoji, so a change to them can add or drop some.
    setRecentEmoji(getRecentEmojis(mx, limit, packs));
    const handleAccountData = (event: MatrixEvent) => {
      if (event.getType() !== AccountDataEvent.ElementRecentEmoji) return;
      setRecentEmoji(getRecentEmojis(mx, limit, packs));
    };

    mx.on(ClientEvent.AccountData, handleAccountData);
    return () => {
      mx.removeListener(ClientEvent.AccountData, handleAccountData);
    };
  }, [mx, limit, packs]);

  return recentEmoji;
};
