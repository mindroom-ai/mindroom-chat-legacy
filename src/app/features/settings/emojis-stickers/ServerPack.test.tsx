import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImagePack } from '../../../plugins/custom-emoji';
import { RoomSettingsPage } from '../../../state/roomSettings';
import { ServerPack } from './ServerPack';

const ALICE = '@alice:example.org';
const hooks = vi.hoisted(() => ({
  useServerEmojiRoom: vi.fn(),
  useRoomImagePacks: vi.fn(),
  usePowerLevels: vi.fn(),
  openRoomSettings: vi.fn(),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@alice:example.org' }),
}));
vi.mock('../../../hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../../../mindroom/server-emoji/useServerEmojiRoom', () => ({
  useServerEmojiRoom: hooks.useServerEmojiRoom,
}));
vi.mock('../../../hooks/useImagePacks', () => ({ useRoomImagePacks: hooks.useRoomImagePacks }));
vi.mock('../../../hooks/usePowerLevels', async (importActual) => ({
  ...(await importActual<typeof import('../../../hooks/usePowerLevels')>()),
  usePowerLevels: hooks.usePowerLevels,
}));
vi.mock('../../../hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set<string>() }));
vi.mock('../../../state/hooks/roomSettings', () => ({
  useOpenRoomSettings: () => hooks.openRoomSettings,
}));
vi.mock('../styles.css', () => ({ SequenceCardStyle: 'card' }));
vi.mock('../../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../../components/setting-tile', () => ({
  SettingTile: ({ title, description, before, after }: Record<string, React.ReactNode>) => (
    <div>
      {before}
      <span>{title}</span>
      <span>{description}</span>
      {after}
    </div>
  ),
}));

const serverRoom = { roomId: '!emoji' };
const address = (stateKey: string) => ({ roomId: '!emoji', stateKey });
const livePack = (stateKey: string, name: string) =>
  new ImagePack(`$${stateKey}`, { pack: { display_name: name }, images: {} }, address(stateKey));
// A deleted pack is a state event with empty content.
const deletedPack = (stateKey: string) => new ImagePack(`$${stateKey}`, {}, address(stateKey));

// A moderator may add emoji but not change power levels, which takes level 100.
const powerLevelsOf = (level: number) => ({
  users: { [ALICE]: level },
  events: { 'im.ponies.room_emotes': 50, 'm.room.power_levels': 100 },
});

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  hooks.useServerEmojiRoom.mockReturnValue(serverRoom);
  hooks.useRoomImagePacks.mockReturnValue([livePack('', 'MindRoom')]);
  hooks.usePowerLevels.mockReturnValue(powerLevelsOf(50));
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
});

const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join(' ');

const element = (onViewPack: () => void) => <ServerPack onViewPack={onViewPack} />;

const renderSection = () => {
  const onViewPack = vi.fn();
  act(() => {
    renderer = create(element(onViewPack));
  });
  return { onViewPack, rerender: () => act(() => renderer!.update(element(onViewPack))) };
};

const buttons = (label: string) =>
  renderer!.root.findAllByType('button').filter((button) => textOf(button) === label);

const click = (button: ReactTestInstance) => act(() => button.props.onClick());

describe('ServerPack', () => {
  it('renders nothing without a server emoji room', () => {
    hooks.useServerEmojiRoom.mockReturnValue(undefined);

    renderSection();

    expect(renderer!.toJSON()).toBeNull();
  });

  it('lists the server packs and opens one', () => {
    const first = livePack('', 'Parrots');
    const overflow = livePack('2', 'Cats');
    hooks.useRoomImagePacks.mockReturnValue([first, deletedPack('3'), overflow]);
    const { onViewPack } = renderSection();

    const text = textOf(renderer!.root);
    expect(text).toContain('Server Emoji');
    expect(text).toContain('Everyone on example.org can use these.');
    expect(text).toContain('Parrots');
    expect(text).toContain('Cats');
    // The deleted pack at '3' gets no tile.
    expect(buttons('View')).toHaveLength(2);

    click(buttons('View')[0]);

    expect(onViewPack).toHaveBeenCalledTimes(1);
    expect(onViewPack).toHaveBeenCalledWith(first);
    expect(onViewPack.mock.calls[0][0].address).toEqual({ roomId: '!emoji', stateKey: '' });

    click(buttons('View')[1]);

    expect(onViewPack).toHaveBeenLastCalledWith(overflow);
  });

  it.each([
    ['no pack', []],
    ['only a deleted pack', [deletedPack('')]],
  ])('offers the first pack when the room has none yet: %s', (_case, packs) => {
    hooks.useRoomImagePacks.mockReturnValue(packs);
    const { onViewPack } = renderSection();

    expect(buttons('View')).toHaveLength(1);
    click(buttons('View')[0]);

    expect(onViewPack).toHaveBeenCalledTimes(1);
    const [opened] = onViewPack.mock.calls[0];
    expect(opened).toBeInstanceOf(ImagePack);
    expect(opened.address).toEqual({ roomId: '!emoji', stateKey: '' });
  });

  it('shows the packs of the new room when the server emoji room changes while open', () => {
    // Like the real hook, the packs are read once per mounted section.
    hooks.useRoomImagePacks.mockImplementation((room: { roomId: string }) => {
      const [packs] = React.useState(() => [
        new ImagePack(
          `$${room.roomId}`,
          { pack: { display_name: room.roomId }, images: {} },
          {
            roomId: room.roomId,
            stateKey: '',
          }
        ),
      ]);
      return packs;
    });
    const { onViewPack, rerender } = renderSection();

    // The configured alias moved to another joined room.
    hooks.useServerEmojiRoom.mockReturnValue({ roomId: '!emoji-new' });
    rerender();
    click(buttons('View')[0]);

    expect(onViewPack.mock.calls[0][0].address).toEqual({ roomId: '!emoji-new', stateKey: '' });
  });

  it('shows Permissions only to users who may change power levels', () => {
    const { rerender } = renderSection();

    expect(buttons('Permissions')).toHaveLength(0);

    hooks.usePowerLevels.mockReturnValue(powerLevelsOf(100));
    rerender();

    expect(buttons('Permissions')).toHaveLength(1);
    click(buttons('Permissions')[0]);

    expect(hooks.openRoomSettings).toHaveBeenCalledWith(
      '!emoji',
      undefined,
      RoomSettingsPage.PermissionsPage
    );
  });
});
