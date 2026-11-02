// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../../hooks/useClientConfig';
import {
  computerServicePreferenceAtom,
  loadComputerServicePreference,
} from '../computer/computerServiceSettings';
import { MindroomComputerSettings } from './MindroomComputerSettings';

const discovery = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock('../server/useMindroomServers', () => ({
  useMindroomServerUrls: () => discovery.urls,
}));
vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children, role }: { children?: React.ReactNode; role?: string }) => (
    <span role={role}>{children}</span>
  ),
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Input: ({
    size: _size,
    variant: _variant,
    ...props
  }: Omit<React.ComponentProps<'input'>, 'size'> & { size?: string; variant?: string }) => (
    <input {...props} />
  ),
  color: { Critical: { Main: 'red' } },
}));
vi.mock('../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) => <section>{children}</section>,
}));
vi.mock('../../components/setting-tile', () => ({
  SettingTile: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

let renderer: ReactTestRenderer;
let store: ReturnType<typeof createStore>;
const button = (label: string) =>
  renderer.root
    .findAllByType('button')
    .find((node) => node.findByType('span').children.join('') === label)!;
const input = () => renderer.root.findByType('input');
const message = (role: string) =>
  renderer.root.findAllByType('span').find((node) => node.props.role === role)!;
const edit = (value: string) => act(() => input().props.onChange({ currentTarget: { value } }));
const click = (label: string) => act(() => button(label).props.onClick());

beforeEach(() => {
  localStorage.clear();
  store = createStore();
  discovery.urls = [];
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.restoreAllMocks();
});
const render = (deploymentUrl = '') =>
  act(() => {
    renderer = create(
      <Provider store={store}>
        <ClientConfigProvider value={{ mindroom: { computers: { apiUrl: deploymentUrl } } }}>
          <MindroomComputerSettings />
        </ClientConfigProvider>
      </Provider>
    );
  });

describe('computer service settings', () => {
  it('starts unconfigured without a suggested server or deployment preset', () => {
    render();
    expect(input().props.value).toBe('');
    expect(input().props.placeholder).toBeUndefined();
    expect(loadComputerServicePreference()).toBeNull();
    expect(
      renderer.root.findAllByType('button').map((node) => node.findByType('span').children.join(''))
    ).toEqual(['Save computer service', 'Use app default']);
  });

  it('shows the server found from the agents while the setting follows the default', () => {
    discovery.urls = ['http://localhost:8765'];
    render();
    expect(input().props.value).toBe('');
    expect(input().props.placeholder).toBe('http://localhost:8765');
    act(() => renderer.unmount());
    render('https://computer.example.org');
    expect(input().props.placeholder).toBeUndefined();
  });

  it('keeps a service the user previously saved', () => {
    act(() => store.set(computerServicePreferenceAtom, 'https://custom.example'));
    render();
    expect(input().props.value).toBe('https://custom.example');
    expect(loadComputerServicePreference()).toBe('https://custom.example');
  });

  it('explains LAN HTTP before Save, persists it, and clears the notice for HTTPS', () => {
    render();
    edit('http://192.168.1.50:8765/');
    expect(message('note').children).toEqual([
      'HTTP does not encrypt your sign-in or computer traffic. Use it only on a trusted local network.',
    ]);
    expect(loadComputerServicePreference()).toBeNull();
    click('Save computer service');
    expect(loadComputerServicePreference()).toBe('http://192.168.1.50:8765');
    expect(input().props.value).toBe('http://192.168.1.50:8765');
    expect(message('note')).toBeDefined();
    edit('https://custom.example');
    expect(message('note')).toBeUndefined();
  });

  it('requires Save for an entered service, persists it, and keeps confirmation visible', () => {
    render();
    edit('https://custom.example');
    expect(input().props.value).toBe('https://custom.example');
    expect(loadComputerServicePreference()).toBeNull();
    click('Save computer service');
    expect(loadComputerServicePreference()).toBe('https://custom.example');
    expect(message('status').children).toEqual(['Computer service saved.']);
  });

  it('validates custom origins without changing the current service', () => {
    render('https://deployment.example');
    edit('https://user:secret@example.org/path');
    click('Save computer service');
    expect(message('alert')).toBeDefined();
    expect(store.get(computerServicePreferenceAtom)).toBeNull();
    expect(loadComputerServicePreference()).toBeNull();
  });

  it('normalizes custom URLs, disables on blank, and restores the displayed deployment', () => {
    render('https://deployment.example');
    edit('https://custom.example/');
    click('Save computer service');
    expect(input().props.value).toBe('https://custom.example');
    edit('');
    click('Save computer service');
    expect(store.get(computerServicePreferenceAtom)).toBe('');
    click('Use app default');
    expect(input().props.value).toBe('https://deployment.example');
    expect(store.get(computerServicePreferenceAtom)).toBeNull();
    edit('https://unsaved.example');
    click('Use app default');
    expect(input().props.value).toBe('https://deployment.example');
  });

  it('reports failed persistence without activating the entered service', () => {
    render();
    edit('https://custom.example');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    click('Save computer service');
    expect(message('alert').children).toEqual([
      'Could not save the computer service on this device.',
    ]);
    expect(store.get(computerServicePreferenceAtom)).toBeNull();
  });
});
