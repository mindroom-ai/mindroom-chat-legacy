import React from 'react';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShortcodeTakenError, type PackImages } from '../../../plugins/custom-emoji';
import { AddCustomEmoji } from './AddCustomEmoji';

const mx = vi.hoisted(() => ({
  getAccountData: vi.fn(),
  getSafeUserId: vi.fn(() => '@alice:example.org'),
  getUserId: vi.fn(() => '@alice:example.org'),
  setAccountData: vi.fn(),
  uploadContent: vi.fn(),
}));
const server = vi.hoisted(() => ({
  addToServerPack: vi.fn(),
  canAddServerEmoji: vi.fn(),
  useServerEmojiRoom: vi.fn(),
}));
const dom = vi.hoisted(() => ({
  getThumbnail: vi.fn(),
  loadImageElement: vi.fn(),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mx,
}));
vi.mock('../../../mindroom/server-emoji/useServerEmojiRoom', () => ({
  useServerEmojiRoom: server.useServerEmojiRoom,
}));
vi.mock('../../../mindroom/server-emoji/addToServerPack', () => ({
  addToServerPack: server.addToServerPack,
  canAddServerEmoji: server.canAddServerEmoji,
}));
vi.mock('../../../hooks/useObjectURL', () => ({
  useObjectURL: () => 'blob:preview',
}));
vi.mock('../../../utils/dom', () => dom);
vi.mock('../../../utils/user-agent', () => ({ mobileOrTablet: () => false }));
vi.mock('./styles.css', () => ({ AddCustomEmoji: 'form', AddCustomEmojiPreview: 'preview' }));

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  // Without a server emoji room the form adds to the personal pack, as before.
  server.useServerEmojiRoom.mockReturnValue(undefined);
  server.canAddServerEmoji.mockReturnValue(false);
  dom.loadImageElement.mockResolvedValue({ width: 32, height: 24 });
  mx.getAccountData.mockReturnValue(undefined);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
});

const renderForm = (file = new File(['gif'], 'party parrot.gif', { type: 'image/gif' })) => {
  const onAdd = vi.fn();
  const form = () => <AddCustomEmoji file={file} onCancel={vi.fn()} onAdd={onAdd} />;
  act(() => {
    renderer = create(form());
  });
  const rerender = () => act(() => renderer!.update(form()));
  const submit = () =>
    act(async () => {
      renderer!.root
        .findByType('form')
        .props.onSubmit({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    });
  return { file, onAdd, rerender, submit };
};

const textNodes = (text: string) => renderer!.root.findAllByProps({ children: text });
const typeName = (value: string) =>
  act(() => renderer!.root.findByType('input').props.onChange({ target: { value } }));
const addButton = () =>
  renderer!.root.find((node) => node.type === 'button' && node.props.type === 'submit');

/** The personal pack as account data. */
const personalPack = (images: PackImages) =>
  new MatrixEvent({ type: 'im.ponies.user_emotes', content: { images } });

/** A server emoji room whose synced state holds these packs, one per state key. */
const serverRoomWith = (packs: Record<string, PackImages>) =>
  ({
    roomId: '!emoji',
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: () =>
          Object.entries(packs).map(
            ([stateKey, images]) =>
              new MatrixEvent({
                type: 'im.ponies.room_emotes',
                state_key: stateKey,
                content: { images },
                room_id: '!emoji',
                event_id: `$pack${stateKey}`,
              })
          ),
      }),
    }),
  } as unknown as Room);

const serverRoom = serverRoomWith({ '': {} });
const personalDescription = 'It is saved to your Personal Pack, so you can use it in every room.';
const nameTaken = 'That name is taken. Pick another.';

describe('AddCustomEmoji', () => {
  it('uploads the image to the personal pack and selects it', async () => {
    const existing = { url: 'mxc://example.org/old' };
    mx.getAccountData.mockReturnValue(personalPack({ old: existing }));
    mx.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.org/new' });
    mx.setAccountData.mockResolvedValue({});
    const { file, onAdd, submit } = renderForm();

    expect(renderer!.root.findByType('input').props.value).toBe('party-parrot');
    await submit();

    expect(mx.uploadContent).toHaveBeenCalledWith(file, {
      name: 'party parrot.gif',
      type: 'image/gif',
    });
    expect(mx.setAccountData).toHaveBeenCalledWith('im.ponies.user_emotes', {
      images: {
        old: existing,
        'party-parrot': {
          url: 'mxc://example.org/new',
          info: { w: 32, h: 24, mimetype: 'image/gif', size: 3 },
        },
      },
    });
    expect(onAdd).toHaveBeenCalledWith('mxc://example.org/new', 'party-parrot');
  });

  it('keeps the form with an error when the upload fails', async () => {
    mx.uploadContent.mockRejectedValue(new Error('too large'));
    const { onAdd, submit } = renderForm();

    await submit();

    expect(mx.setAccountData).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
    expect(
      renderer!.root.findAllByProps({ children: "Couldn't add the emoji. Try again." })
    ).not.toHaveLength(0);
  });

  it('adds to the server pack when the user may, and says everyone can use it', async () => {
    server.useServerEmojiRoom.mockReturnValue(serverRoom);
    server.canAddServerEmoji.mockReturnValue(true);
    server.addToServerPack.mockResolvedValue(undefined);
    mx.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.org/new' });
    const { onAdd, submit } = renderForm();

    expect(textNodes('Everyone on example.org can use it in every room.')).not.toHaveLength(0);
    expect(textNodes(personalDescription)).toHaveLength(0);
    await submit();

    expect(server.canAddServerEmoji).toHaveBeenCalledWith(mx, serverRoom);
    expect(server.addToServerPack).toHaveBeenCalledWith(mx, serverRoom, 'party-parrot', {
      url: 'mxc://example.org/new',
      info: { w: 32, h: 24, mimetype: 'image/gif', size: 3 },
    });
    expect(mx.setAccountData).not.toHaveBeenCalled();
    expect(onAdd).toHaveBeenCalledWith('mxc://example.org/new', 'party-parrot');
  });

  it('adds and selects the emoji under the name as typed', async () => {
    server.useServerEmojiRoom.mockReturnValue(serverRoom);
    server.canAddServerEmoji.mockReturnValue(true);
    server.addToServerPack.mockResolvedValue(undefined);
    mx.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.org/new' });
    const { onAdd, submit } = renderForm();

    typeName('parrot dance');
    await submit();

    expect(server.addToServerPack).toHaveBeenCalledWith(
      mx,
      serverRoom,
      'parrot-dance',
      expect.anything()
    );
    expect(onAdd).toHaveBeenCalledWith('mxc://example.org/new', 'parrot-dance');
  });

  it('falls back to the personal pack when the user may not add server emoji', async () => {
    const existing = { url: 'mxc://example.org/old' };
    server.useServerEmojiRoom.mockReturnValue(serverRoom);
    server.canAddServerEmoji.mockReturnValue(false);
    mx.getAccountData.mockReturnValue(personalPack({ old: existing }));
    mx.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.org/new' });
    mx.setAccountData.mockResolvedValue({});
    const { onAdd, submit } = renderForm();

    expect(textNodes(personalDescription)).not.toHaveLength(0);
    expect(textNodes('Everyone on example.org can use it in every room.')).toHaveLength(0);
    await submit();

    expect(server.addToServerPack).not.toHaveBeenCalled();
    expect(mx.setAccountData).toHaveBeenCalledWith('im.ponies.user_emotes', {
      images: {
        old: existing,
        'party-parrot': {
          url: 'mxc://example.org/new',
          info: { w: 32, h: 24, mimetype: 'image/gif', size: 3 },
        },
      },
    });
    expect(onAdd).toHaveBeenCalledWith('mxc://example.org/new', 'party-parrot');
  });

  it('submits to the pack its description names, as set when the form last rendered', async () => {
    server.addToServerPack.mockResolvedValue(undefined);
    mx.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.org/new' });
    const { rerender, submit } = renderForm();
    expect(textNodes(personalDescription)).not.toHaveLength(0);

    // The user joins the server emoji room while the form is open.
    server.useServerEmojiRoom.mockReturnValue(serverRoom);
    server.canAddServerEmoji.mockReturnValue(true);
    rerender();
    expect(textNodes('Everyone on example.org can use it in every room.')).not.toHaveLength(0);
    // A power level change after that render does not redirect the submit.
    server.canAddServerEmoji.mockReturnValue(false);
    await submit();

    expect(server.addToServerPack).toHaveBeenCalledTimes(1);
    expect(mx.setAccountData).not.toHaveBeenCalled();
  });

  it('refuses a GIF over 256 KB as soon as it is picked, without uploading it', async () => {
    const gif = new File([new Uint8Array(300 * 1024)], 'party parrot.gif', { type: 'image/gif' });
    const { onAdd, submit } = renderForm(gif);

    expect(textNodes('Animated GIFs must be under 256 KB.')).not.toHaveLength(0);
    expect(addButton().props.disabled).toBe(true);
    await submit();

    expect(mx.uploadContent).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
    expect(textNodes('Animated GIFs must be under 256 KB.')).not.toHaveLength(0);
  });

  it('uploads a large still image drawn at 128 pixels as a PNG', async () => {
    const resized = new Blob(['resized'], { type: 'image/png' });
    dom.loadImageElement.mockResolvedValue({ width: 512, height: 256 });
    dom.getThumbnail.mockResolvedValue(resized);
    mx.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.org/new' });
    mx.setAccountData.mockResolvedValue({});
    const { onAdd, submit } = renderForm(
      new File(['jpeg'], 'party parrot.jpg', { type: 'image/jpeg' })
    );

    await submit();

    const [uploaded, options] = mx.uploadContent.mock.calls[0];
    expect([uploaded.name, uploaded.type, uploaded.size]).toEqual([
      'party parrot.png',
      'image/png',
      resized.size,
    ]);
    expect(options).toEqual({ name: 'party parrot.png', type: 'image/png' });
    expect(mx.setAccountData).toHaveBeenCalledWith('im.ponies.user_emotes', {
      images: {
        'party-parrot': {
          url: 'mxc://example.org/new',
          info: { w: 128, h: 64, mimetype: 'image/png', size: resized.size },
        },
      },
    });
    expect(onAdd).toHaveBeenCalledWith('mxc://example.org/new', 'party-parrot');
  });

  it('says a taken name is taken and keeps Add off until the name is free', async () => {
    mx.getAccountData.mockReturnValue(personalPack({ 'party-parrot': { url: 'mxc://x/old' } }));
    const { submit } = renderForm();

    expect(textNodes(nameTaken)).not.toHaveLength(0);
    expect(addButton().props.disabled).toBe(true);
    await submit();
    expect(mx.uploadContent).not.toHaveBeenCalled();

    typeName('party-parrot-2');
    expect(textNodes(nameTaken)).toHaveLength(0);
    expect(addButton().props.disabled).toBe(false);
  });

  it('checks a name against every server pack when adding to the server', () => {
    server.useServerEmojiRoom.mockReturnValue(
      serverRoomWith({ '': {}, '2': { 'party-parrot': { url: 'mxc://x/old' } } })
    );
    server.canAddServerEmoji.mockReturnValue(true);
    renderForm();

    expect(textNodes(nameTaken)).not.toHaveLength(0);
    expect(addButton().props.disabled).toBe(true);
  });

  it('checks the name again before uploading', async () => {
    const { onAdd, submit } = renderForm();
    expect(textNodes(nameTaken)).toHaveLength(0);

    // Another device adds an emoji with this name after the form rendered.
    mx.getAccountData.mockReturnValue(personalPack({ 'party-parrot': { url: 'mxc://x/old' } }));
    await submit();

    expect(mx.uploadContent).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
    expect(textNodes(nameTaken)).not.toHaveLength(0);
  });

  it('says the name is taken when the server pack got it during the upload', async () => {
    server.useServerEmojiRoom.mockReturnValue(serverRoom);
    server.canAddServerEmoji.mockReturnValue(true);
    server.addToServerPack.mockRejectedValue(new ShortcodeTakenError('party-parrot'));
    mx.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.org/new' });
    const { onAdd, submit } = renderForm();

    await submit();

    expect(onAdd).not.toHaveBeenCalled();
    expect(textNodes(nameTaken)).not.toHaveLength(0);
    // Until sync brings the other emoji in, Add must stay off, or each retry uploads again.
    expect(addButton().props.disabled).toBe(true);

    // The error was about that name; a new one clears it without a generic error.
    typeName('party-parrot-2');
    expect(textNodes(nameTaken)).toHaveLength(0);
    expect(textNodes("Couldn't add the emoji. Try again.")).toHaveLength(0);
    expect(addButton().props.disabled).toBe(false);
  });
});
