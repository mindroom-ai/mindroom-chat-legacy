import React from 'react';
import type { Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { EmojiBoard } from './EmojiBoard';

const recentEmoji = vi.hoisted(() => ({ addRecentEmoji: vi.fn() }));
const addForm = vi.hoisted(() => ({
  onAdd: undefined as ((mxc: string, sc: string) => void) | undefined,
}));
const mx = vi.hoisted(() => ({ getRoom: vi.fn() }));
// Stable like the real hooks' results, which the board memoizes on.
const none = vi.hoisted(() => []);

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./components/styles.css', () =>
  Object.fromEntries(
    ['AddCustomEmoji', 'AddCustomEmojiPreview', 'Base', 'CustomEmojiImg', 'EmojiGroup']
      .concat(['EmojiGroupContent', 'EmojiGroupLabel', 'EmojiItem', 'Header', 'Preview'])
      .concat(['PreviewEmoji', 'PreviewImg', 'Sidebar', 'SidebarBtnImg', 'SidebarContent'])
      .concat(['SidebarDivider', 'SidebarStack', 'StickerImg', 'StickerItem'])
      .map((name) => [name, name])
  )
);
vi.mock('../virtualizer/style.css', () => ({ VirtualTile: 'VirtualTile' }));
vi.mock('./components/AddCustomEmoji', () => ({
  AddCustomEmoji: ({ onAdd }: { onAdd: (mxc: string, shortcode: string) => void }) => {
    addForm.onAdd = onAdd;
    return null;
  },
}));
vi.mock('../../utils/user-agent', () => ({ mobileOrTablet: () => false }));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../../hooks/useImagePacks', () => ({ useRelevantImagePacks: () => none }));
vi.mock('../../hooks/useRecentEmoji', () => ({ useRecentEmoji: () => none }));
vi.mock('../../hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../../hooks/useFilePicker', () => ({
  useFilePicker: (onSelect: (file: File) => void) => () =>
    onSelect(new File(['png'], 'parrot.png', { type: 'image/png' })),
}));
vi.mock('../../plugins/recent-emoji', () => recentEmoji);

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
});

const renderBoard = () => {
  const onCustomEmojiSelect = vi.fn();
  act(() => {
    renderer = create(
      <EmojiBoard
        imagePackRooms={[] as Room[]}
        requestClose={vi.fn()}
        onCustomEmojiSelect={onCustomEmojiSelect}
      />
    );
  });
  return onCustomEmojiSelect;
};

/** A click on a board item, as the item list hands it on to the board. */
const clickItem = (attributes: Record<string, string>) => {
  const button = {
    matches: (selector: string) => selector === 'button',
    getAttribute: (name: string) => attributes[name] ?? null,
  };
  const list = renderer!.root.findAll((node) => typeof node.props.onMouseMove === 'function')[0];
  act(() =>
    list.props.onClick({
      nativeEvent: { composedPath: () => [button] },
      altKey: false,
      shiftKey: false,
    })
  );
};

it('records a picked custom emoji among the recent ones by its mxc URL', () => {
  const onCustomEmojiSelect = renderBoard();

  clickItem({
    title: 'party-parrot',
    'data-emoji-type': 'customEmoji',
    'data-emoji-data': 'mxc://example.org/parrot',
    'data-emoji-shortcode': 'party-parrot',
  });

  expect(onCustomEmojiSelect).toHaveBeenCalledWith('mxc://example.org/parrot', 'party-parrot');
  expect(recentEmoji.addRecentEmoji).toHaveBeenCalledWith(mx, 'mxc://example.org/parrot');
});

it('records an emoji added from the board among the recent ones', () => {
  const onCustomEmojiSelect = renderBoard();
  const addButton = renderer!.root.find(
    (node) => node.type === 'button' && node.props['aria-label'] === 'Add custom emoji'
  );
  act(() => addButton.props.onClick());

  act(() => addForm.onAdd!('mxc://example.org/new', 'parrot'));

  expect(onCustomEmojiSelect).toHaveBeenCalledWith('mxc://example.org/new', 'parrot');
  expect(recentEmoji.addRecentEmoji).toHaveBeenCalledWith(mx, 'mxc://example.org/new');
});
