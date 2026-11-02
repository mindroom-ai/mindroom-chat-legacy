import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import React, { KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect } from 'react';
import { Editor } from 'slate';
import { Box, config, Text } from 'folds';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import { AutocompleteMenu, AutocompleteQuery, moveCursor } from '../../components/editor';
import { insertMindroomCommand } from './mindroomCommandQuery';
import { UseAsyncSearchOptions, useAsyncSearch } from '../../hooks/useAsyncSearch';
import { useKeyDown } from '../../hooks/useKeyDown';
import { onTabPress } from '../../utils/keyboard';
import { MINDROOM_COMMANDS, MindroomCommandItem } from './mindroomCommands';

const getCommandDescription = (t: TFunction, command: MindroomCommandItem): string => {
  switch (command.name) {
    case 'help':
      return t('mindroomUi.commands.descriptions.help');
    case 'reload-plugins':
      return t('mindroomUi.commands.descriptions.reload-plugins');
    case 'schedule':
      return t('mindroomUi.commands.descriptions.schedule');
    case 'list_schedules':
      return t('mindroomUi.commands.descriptions.list_schedules');
    case 'cancel_schedule':
      return t('mindroomUi.commands.descriptions.cancel_schedule');
    case 'edit_schedule':
      return t('mindroomUi.commands.descriptions.edit_schedule');
    case 'jobs':
      return t('mindroomUi.commands.descriptions.jobs');
    case 'cancel_job':
      return t('mindroomUi.commands.descriptions.cancel_job');
    case 'config':
      return t('mindroomUi.commands.descriptions.config');
    case 'desktop':
      return t('mindroomUi.commands.descriptions.desktop');
    case 'mode':
      return t('mindroomUi.commands.descriptions.mode');
    case 'model':
      return t('mindroomUi.commands.descriptions.model');
    case 'room_model':
      return t('mindroomUi.commands.descriptions.room_model');
    case 'thread_mode':
      return t('mindroomUi.commands.descriptions.thread_mode');
    case 'auto_approve':
      return t('mindroomUi.commands.descriptions.auto_approve');
    case 'encrypt':
      return t('mindroomUi.commands.descriptions.encrypt');
    case 'e2ee':
      return t('mindroomUi.commands.descriptions.e2ee');
    case 'hi':
      return t('mindroomUi.commands.descriptions.hi');
    default:
      return command.description;
  }
};

type MindroomCommandAutocompleteProps = {
  editor: Editor;
  query: AutocompleteQuery<string>;
  requestClose: () => void;
};

const SEARCH_OPTIONS: UseAsyncSearchOptions = {
  matchOptions: {
    contain: true,
  },
};

export function MindroomCommandAutocomplete({
  editor,
  query,
  requestClose,
}: MindroomCommandAutocompleteProps) {
  const { t } = useTranslation();
  const [result, search, resetSearch] = useAsyncSearch(
    MINDROOM_COMMANDS,
    useCallback((item: MindroomCommandItem) => item.name, []),
    SEARCH_OPTIONS
  );

  useEffect(() => {
    if (query.text) search(query.text);
    else resetSearch();
  }, [query.text, search, resetSearch]);

  const commands = result ? result.items : MINDROOM_COMMANDS;

  const handleAutocomplete = (command: MindroomCommandItem) => {
    insertMindroomCommand(editor, query.range, command.name);
    moveCursor(editor, true);
    requestClose();
  };

  useKeyDown(window, (evt: KeyboardEvent) => {
    onTabPress(evt, () => {
      if (commands.length === 0) return;
      handleAutocomplete(commands[0]);
    });
  });

  return commands.length === 0 ? null : (
    <AutocompleteMenu
      headerContent={
        <Box grow="Yes" direction="Row" gap="200" justifyContent="SpaceBetween">
          <Text size="L400">
            {t('mindroomUi.commands.mindroomCommandAutocomplete.mindroomCommands')}
          </Text>
        </Box>
      }
      requestClose={requestClose}
    >
      {commands.map((command) => (
        <MenuItem
          key={command.name}
          as="button"
          radii="300"
          style={{ height: 'unset' }}
          onKeyDown={(evt: ReactKeyboardEvent<HTMLButtonElement>) =>
            onTabPress(evt, () => handleAutocomplete(command))
          }
          onClick={() => handleAutocomplete(command)}
        >
          <Box
            style={{ padding: `${config.space.S300} 0` }}
            grow="Yes"
            direction="Column"
            gap="100"
            justifyContent="SpaceBetween"
          >
            <Text style={{ flexGrow: 1 }} size="B400" truncate>
              {command.syntax}
            </Text>
            <Text truncate priority="300" size="T200">
              {getCommandDescription(t, command)}
            </Text>
          </Box>
        </MenuItem>
      ))}
    </AutocompleteMenu>
  );
}
