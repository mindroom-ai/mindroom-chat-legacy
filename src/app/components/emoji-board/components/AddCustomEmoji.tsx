import { useTranslation } from 'react-i18next';
import React, { ChangeEvent, FormEventHandler, useCallback, useState } from 'react';
import { Box, Button, Input, Spinner, Text, color } from 'folds';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useObjectURL } from '../../../hooks/useObjectURL';
import { useAlive } from '../../../hooks/useAlive';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { loadImageElement } from '../../../utils/dom';
import { getMxIdServer } from '../../../utils/matrix';
import { getAccountData } from '../../../utils/room';
import { getFileNameWithoutExt } from '../../../utils/mimeTypes';
import { mobileOrTablet } from '../../../utils/user-agent';
import { AccountDataEvent } from '../../../../types/matrix/accountData';
import {
  addEmoticonToPackContent,
  getRoomImagePacks,
  getUserImagePack,
  PackContent,
  PackImage,
  packsHaveShortcode,
  ShortcodeTakenError,
} from '../../../plugins/custom-emoji';
import {
  EmojiImageTooLargeError,
  MAX_ANIMATED_EMOJI_BYTES,
  prepareEmojiImage,
} from '../../../plugins/custom-emoji/prepareEmojiImage';
import { addToServerPack, canAddServerEmoji } from '../../../mindroom/server-emoji/addToServerPack';
import { useServerEmojiRoom } from '../../../mindroom/server-emoji/useServerEmojiRoom';
import * as css from './styles.css';

const toShortcode = (name: string): string => name.trim().replace(/[\s:]+/g, '-');

/** Whether the target packs, as last synced, have an image under the shortcode. */
const isShortcodeTaken = (mx: MatrixClient, serverPackRoom: Room | undefined, shortcode: string) =>
  packsHaveShortcode(
    serverPackRoom ? getRoomImagePacks(serverPackRoom) : [getUserImagePack(mx)],
    shortcode
  );

type AddCustomEmojiProps = {
  file: File;
  onCancel: () => void;
  onAdd: (mxc: string, shortcode: string) => void;
};

// Adds the picked image to the server's shared pack when the user may, otherwise
// to their personal pack; every room's emoji board shows both.
export function AddCustomEmoji({ file, onCancel, onAdd }: AddCustomEmojiProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const alive = useAlive();
  const serverRoom = useServerEmojiRoom();
  // Decided once per render, so the description and the submit agree on the target.
  const serverPackRoom = serverRoom && canAddServerEmoji(mx, serverRoom) ? serverRoom : undefined;
  const previewUrl = useObjectURL(file);
  const [name, setName] = useState(() => toShortcode(getFileNameWithoutExt(file.name)));
  const shortcode = toShortcode(name);

  const [addState, addEmoji] = useAsyncCallback(
    useCallback(async () => {
      // Check again: a sync since the last render may have brought the name in.
      if (isShortcodeTaken(mx, serverPackRoom, shortcode)) throw new ShortcodeTakenError(shortcode);
      const img = await loadImageElement(previewUrl ?? '');
      const prepared = await prepareEmojiImage(file, img);
      const { content_uri: mxc } = await mx.uploadContent(prepared.file, {
        name: prepared.file.name,
        type: prepared.file.type,
      });
      const image: PackImage = { url: mxc, info: prepared.info };
      if (serverPackRoom) {
        await addToServerPack(mx, serverPackRoom, shortcode, image);
        return mxc;
      }
      // Read the pack only now, so an edit made meanwhile is kept.
      const pack = getAccountData(mx, AccountDataEvent.PoniesUserEmotes)?.getContent<PackContent>();
      const content = addEmoticonToPackContent(pack, shortcode, image);
      await mx.setAccountData(AccountDataEvent.PoniesUserEmotes as any, content as any);
      return mxc;
    }, [mx, file, previewUrl, shortcode, serverPackRoom])
  );
  const adding = addState.status === AsyncStatus.Loading;
  // Not while adding, as the new emoji can sync before its write returns.
  const taken = !adding && isShortcodeTaken(mx, serverPackRoom, shortcode);
  // A GIF is uploaded as it is, so one over the cap is refused as soon as it is picked.
  const gifTooLarge = file.type === 'image/gif' && file.size > MAX_ANIMATED_EMOJI_BYTES;
  const addError = addState.status === AsyncStatus.Error ? addState.error : undefined;
  // A taken-name error is about the name it was raised for; a new name clears it.
  const takenError = addError instanceof ShortcodeTakenError;
  // The server can report a name taken before sync brings it here, so that also keeps Add off.
  const nameTaken = taken || (takenError && addError.shortcode === shortcode);
  let errorText: string | undefined;
  if (nameTaken) {
    errorText = t('sharedUi.emojiBoard.addCustomEmojiNameTaken');
  } else if (gifTooLarge || addError instanceof EmojiImageTooLargeError) {
    errorText = t('sharedUi.emojiBoard.addCustomEmojiTooLarge', {
      limit: `${MAX_ANIMATED_EMOJI_BYTES / 1024} KB`,
    });
  } else if (addState.status === AsyncStatus.Error && !takenError) {
    errorText = t('sharedUi.emojiBoard.addCustomEmojiFailed');
  }

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    // The board can sit inside another form (power tags), which would also get this submit.
    evt.stopPropagation();
    if (!shortcode || nameTaken || gifTooLarge || adding) return;
    addEmoji().then(
      (mxc) => {
        if (alive()) onAdd(mxc, shortcode);
      },
      () => undefined
    );
  };

  return (
    <Box
      as="form"
      className={css.AddCustomEmoji}
      grow="Yes"
      direction="Column"
      gap="400"
      onSubmit={handleSubmit}
    >
      <Text size="T300" priority="300">
        {serverPackRoom
          ? t('sharedUi.emojiBoard.addCustomEmojiServerDescription', {
              server: getMxIdServer(mx.getSafeUserId()),
            })
          : t('sharedUi.emojiBoard.addCustomEmojiDescription')}
      </Text>
      <Box alignItems="Center" gap="300">
        <img className={css.AddCustomEmojiPreview} src={previewUrl} alt="" />
        <Box grow="Yes" direction="Column">
          <Input
            before={<Text size="L400">{t('sharedUi.imageTile.shortcode')}</Text>}
            value={name}
            onChange={(evt: ChangeEvent<HTMLInputElement>) => setName(evt.target.value)}
            variant="SurfaceVariant"
            size="400"
            radii="300"
            maxLength={100}
            required
            // The save uses the name as submitted, so it cannot change while the upload runs.
            disabled={adding}
            autoFocus={!mobileOrTablet()}
          />
        </Box>
      </Box>
      {errorText && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {errorText}
        </Text>
      )}
      <Box justifyContent="End" gap="200">
        <Button
          type="button"
          variant="Secondary"
          fill="Soft"
          size="300"
          radii="300"
          disabled={adding}
          onClick={onCancel}
        >
          <Text size="B300">{t('sharedUi.imageTile.cancel')}</Text>
        </Button>
        <Button
          type="submit"
          variant="Primary"
          size="300"
          radii="300"
          disabled={!shortcode || nameTaken || gifTooLarge || adding}
          before={adding && <Spinner variant="Primary" fill="Solid" size="100" />}
        >
          <Text size="B300">{t('sharedUi.emojiBoard.add')}</Text>
        </Button>
      </Box>
    </Box>
  );
}
