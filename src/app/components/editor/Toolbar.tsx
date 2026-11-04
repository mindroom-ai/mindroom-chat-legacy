import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import {
  Badge,
  Box,
  config,
  Icon,
  Icons,
  IconSrc,
  Line,
  PopOut,
  RectCords,
  Scroll,
  Text,
  Tooltip,
  TooltipProvider,
  toRem,
} from 'folds';
import React, { MouseEventHandler, ReactNode, useState } from 'react';
import { ReactEditor, useSlate } from 'slate-react';
import { Menu } from '../glass/GlassPrimitives';
import { ComposerIconButton } from './ComposerIconButton';
import {
  headingLevel,
  isAnyMarkActive,
  isBlockActive,
  isMarkActive,
  removeAllMark,
  toggleBlock,
  toggleMark,
} from './utils';
import * as css from './Editor.css';
import { BlockType, MarkType } from './types';
import { HeadingLevel } from './slate';
import { isMacOS } from '../../utils/user-agent';
import { KeySymbol } from '../../utils/key-symbol';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { stopPropagation } from '../../utils/keyboard';

function BtnTooltip({ text, shortCode }: { text: string; shortCode?: string }) {
  return (
    <Tooltip style={{ padding: config.space.S300 }}>
      <Box gap="200" direction="Column" alignItems="Center">
        <Text align="Center">{text}</Text>
        {shortCode && (
          <Badge as="kbd" radii="300" size="500">
            <Text size="T200" align="Center">
              {shortCode}
            </Text>
          </Badge>
        )}
      </Box>
    </Tooltip>
  );
}

type MarkButtonProps = { format: MarkType; icon: IconSrc; tooltip: ReactNode };
export function MarkButton({ format, icon, tooltip }: MarkButtonProps) {
  const editor = useSlate();
  const disableInline = isBlockActive(editor, BlockType.CodeBlock);

  if (disableInline) {
    removeAllMark(editor);
  }

  const handleClick = () => {
    toggleMark(editor, format);
    ReactEditor.focus(editor);
  };

  return (
    <TooltipProvider tooltip={tooltip} delay={500}>
      {(triggerRef) => (
        <ComposerIconButton
          ref={triggerRef}
          onClick={handleClick}
          pressed={isMarkActive(editor, format)}
          size="400"
          radii="300"
          disabled={disableInline}
        >
          <Icon size="200" src={icon} />
        </ComposerIconButton>
      )}
    </TooltipProvider>
  );
}

type BlockButtonProps = {
  format: BlockType;
  icon: IconSrc;
  tooltip: ReactNode;
};
export function BlockButton({ format, icon, tooltip }: BlockButtonProps) {
  const editor = useSlate();

  const handleClick = () => {
    toggleBlock(editor, format, { level: 1 });
    ReactEditor.focus(editor);
  };

  return (
    <TooltipProvider tooltip={tooltip} delay={500}>
      {(triggerRef) => (
        <ComposerIconButton
          ref={triggerRef}
          onClick={handleClick}
          pressed={isBlockActive(editor, format)}
          size="400"
          radii="300"
        >
          <Icon size="200" src={icon} />
        </ComposerIconButton>
      )}
    </TooltipProvider>
  );
}

export function HeadingBlockButton() {
  const { t } = useTranslation();
  const editor = useSlate();
  const level = headingLevel(editor);
  const [anchor, setAnchor] = useState<RectCords>();
  const isActive = isBlockActive(editor, BlockType.Heading);

  const handleMenuSelect = (selectedLevel: HeadingLevel) => {
    setAnchor(undefined);
    toggleBlock(editor, BlockType.Heading, { level: selectedLevel });
    ReactEditor.focus(editor);
  };

  const handleMenuOpen: MouseEventHandler<HTMLButtonElement> = (evt) => {
    if (isActive) {
      toggleBlock(editor, BlockType.Heading);
      return;
    }
    setAnchor(evt.currentTarget.getBoundingClientRect());
  };
  return (
    <PopOut
      anchor={anchor}
      offset={5}
      position="Top"
      content={
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: () => setAnchor(undefined),
            clickOutsideDeactivates: true,
            isKeyForward: (evt: KeyboardEvent) =>
              evt.key === 'ArrowDown' || evt.key === 'ArrowRight',
            isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp' || evt.key === 'ArrowLeft',
            escapeDeactivates: stopPropagation,
          }}
        >
          <Menu style={{ padding: config.space.S100 }}>
            <Box gap="100">
              <TooltipProvider
                tooltip={<BtnTooltip text={t('sharedUi.toolbar.heading1')} />}
                delay={500}
              >
                {(triggerRef) => (
                  <ComposerIconButton
                    ref={triggerRef}
                    onClick={() => handleMenuSelect(1)}
                    size="400"
                    radii="300"
                  >
                    <Icon size="200" src={Icons.Heading1} />
                  </ComposerIconButton>
                )}
              </TooltipProvider>
              <TooltipProvider
                tooltip={<BtnTooltip text={t('sharedUi.toolbar.heading2')} />}
                delay={500}
              >
                {(triggerRef) => (
                  <ComposerIconButton
                    ref={triggerRef}
                    onClick={() => handleMenuSelect(2)}
                    size="400"
                    radii="300"
                  >
                    <Icon size="200" src={Icons.Heading2} />
                  </ComposerIconButton>
                )}
              </TooltipProvider>
              <TooltipProvider
                tooltip={<BtnTooltip text={t('sharedUi.toolbar.heading3')} />}
                delay={500}
              >
                {(triggerRef) => (
                  <ComposerIconButton
                    ref={triggerRef}
                    onClick={() => handleMenuSelect(3)}
                    size="400"
                    radii="300"
                  >
                    <Icon size="200" src={Icons.Heading3} />
                  </ComposerIconButton>
                )}
              </TooltipProvider>
            </Box>
          </Menu>
        </FocusTrap>
      }
    >
      <ComposerIconButton
        style={{ width: 'unset' }}
        onClick={handleMenuOpen}
        pressed={isActive}
        size="400"
        radii="300"
      >
        <Icon size="200" src={level ? Icons[`Heading${level}`] : Icons.Heading1} />
        <Icon size="200" src={isActive ? Icons.Cross : Icons.ChevronBottom} />
      </ComposerIconButton>
    </PopOut>
  );
}

type ExitFormattingProps = { tooltip: ReactNode };
export function ExitFormatting({ tooltip }: ExitFormattingProps) {
  const { t } = useTranslation();
  const editor = useSlate();

  const handleClick = () => {
    if (isAnyMarkActive(editor)) {
      removeAllMark(editor);
    } else if (!isBlockActive(editor, BlockType.Paragraph)) {
      toggleBlock(editor, BlockType.Paragraph);
    }
    ReactEditor.focus(editor);
  };

  return (
    <TooltipProvider tooltip={tooltip} delay={500}>
      {(triggerRef) => (
        <ComposerIconButton ref={triggerRef} onClick={handleClick} size="400" radii="300">
          <Text size="B400">{t('sharedUi.toolbar.exitValue1', { value1: KeySymbol.Hyper })}</Text>
        </ComposerIconButton>
      )}
    </TooltipProvider>
  );
}

export function Toolbar() {
  const { t } = useTranslation();
  const editor = useSlate();
  const modKey = isMacOS() ? KeySymbol.Command : 'Ctrl';
  const disableInline = isBlockActive(editor, BlockType.CodeBlock);

  const canEscape = isBlockActive(editor, BlockType.Paragraph)
    ? isAnyMarkActive(editor)
    : ReactEditor.isFocused(editor);
  const [isMarkdown, setIsMarkdown] = useSetting(settingsAtom, 'isMarkdown');

  return (
    <Box className={css.EditorToolbarBase}>
      <Scroll direction="Horizontal" size="0">
        <Box className={css.EditorToolbar} alignItems="Center" gap="300">
          <>
            <Box shrink="No" gap="100">
              <MarkButton
                format={MarkType.Bold}
                icon={Icons.Bold}
                tooltip={
                  <BtnTooltip text={t('sharedUi.toolbar.bold')} shortCode={`${modKey} + B`} />
                }
              />
              <MarkButton
                format={MarkType.Italic}
                icon={Icons.Italic}
                tooltip={
                  <BtnTooltip text={t('sharedUi.toolbar.italic')} shortCode={`${modKey} + I`} />
                }
              />
              <MarkButton
                format={MarkType.Underline}
                icon={Icons.Underline}
                tooltip={
                  <BtnTooltip text={t('sharedUi.toolbar.underline')} shortCode={`${modKey} + U`} />
                }
              />
              <MarkButton
                format={MarkType.StrikeThrough}
                icon={Icons.Strike}
                tooltip={
                  <BtnTooltip
                    text={t('sharedUi.toolbar.strikeThrough')}
                    shortCode={`${modKey} + S`}
                  />
                }
              />
              <MarkButton
                format={MarkType.Code}
                icon={Icons.Code}
                tooltip={
                  <BtnTooltip text={t('sharedUi.toolbar.inlineCode')} shortCode={`${modKey} + [`} />
                }
              />
              <MarkButton
                format={MarkType.Spoiler}
                icon={Icons.EyeBlind}
                tooltip={
                  <BtnTooltip text={t('sharedUi.toolbar.spoiler')} shortCode={`${modKey} + H`} />
                }
              />
            </Box>
            <Line variant="SurfaceVariant" direction="Vertical" style={{ height: toRem(12) }} />
          </>
          <Box shrink="No" gap="100">
            <BlockButton
              format={BlockType.BlockQuote}
              icon={Icons.BlockQuote}
              tooltip={
                <BtnTooltip text={t('sharedUi.toolbar.blockQuote')} shortCode={`${modKey} + '`} />
              }
            />
            <BlockButton
              format={BlockType.CodeBlock}
              icon={Icons.BlockCode}
              tooltip={
                <BtnTooltip text={t('sharedUi.toolbar.blockCode')} shortCode={`${modKey} + ;`} />
              }
            />
            <BlockButton
              format={BlockType.OrderedList}
              icon={Icons.OrderList}
              tooltip={
                <BtnTooltip text={t('sharedUi.toolbar.orderedList')} shortCode={`${modKey} + 7`} />
              }
            />
            <BlockButton
              format={BlockType.UnorderedList}
              icon={Icons.UnorderList}
              tooltip={
                <BtnTooltip
                  text={t('sharedUi.toolbar.unorderedList')}
                  shortCode={`${modKey} + 8`}
                />
              }
            />
            <HeadingBlockButton />
          </Box>
          {canEscape && (
            <>
              <Line variant="SurfaceVariant" direction="Vertical" style={{ height: toRem(12) }} />
              <Box shrink="No" gap="100">
                <ExitFormatting
                  tooltip={
                    <BtnTooltip
                      text={t('sharedUi.toolbar.exitFormatting')}
                      shortCode={`Escape, ${modKey} + E`}
                    />
                  }
                />
              </Box>
            </>
          )}
          <Box className={css.MarkdownBtnBox} shrink="No" grow="Yes" justifyContent="End">
            <TooltipProvider
              align="End"
              tooltip={
                <BtnTooltip
                  text={
                    isMarkdown
                      ? t('sharedUi.toolbar.disableMarkdown')
                      : t('sharedUi.toolbar.enableMarkdown')
                  }
                />
              }
              delay={500}
            >
              {(triggerRef) => (
                <ComposerIconButton
                  ref={triggerRef}
                  onClick={() => setIsMarkdown(!isMarkdown)}
                  pressed={isMarkdown}
                  size="300"
                  radii="300"
                  disabled={disableInline || !!isAnyMarkActive(editor)}
                >
                  <Icon size="200" src={Icons.Markdown} filled={isMarkdown} />
                </ComposerIconButton>
              )}
            </TooltipProvider>
            <span />
          </Box>
        </Box>
      </Scroll>
    </Box>
  );
}
