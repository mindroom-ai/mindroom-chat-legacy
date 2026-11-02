import { describe, expect, it } from 'vitest';
import en from '../../locales/en.json';
import { MINDROOM_COMMANDS } from './mindroomCommands';

describe('MINDROOM_COMMANDS', () => {
  it('mirrors the MindRoom bot command set', () => {
    const names = MINDROOM_COMMANDS.map((c) => c.name);
    expect(names).toEqual([
      'help',
      'reload-plugins',
      'schedule',
      'list_schedules',
      'cancel_schedule',
      'edit_schedule',
      'jobs',
      'cancel_job',
      'config',
      'desktop',
      'mode',
      'model',
      'room_model',
      'thread_mode',
      'auto_approve',
      'encrypt',
      'e2ee',
      'hi',
    ]);
  });

  it('prefixes every syntax with the command name', () => {
    MINDROOM_COMMANDS.forEach((command) => {
      expect(command.syntax.startsWith(`!${command.name}`)).toBe(true);
    });
  });

  it('has a translated description for every command', () => {
    const descriptions: Record<string, string> = en.mindroomUi.commands.descriptions;
    MINDROOM_COMMANDS.forEach((command) => {
      expect(descriptions[command.name]).toBe(command.description);
    });
  });
});
