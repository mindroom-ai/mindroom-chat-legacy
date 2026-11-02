import React from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../locales/en.json';
import { ApprovalArguments } from './ApprovalArguments';
import { parseToolApprovalContent } from './toolApproval';

vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
const mocks = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('./sidecarDownload', () => ({ downloadMindroomSidecarBlob: mocks.download }));
vi.mock('./ApprovalArgumentFields.css', () => ({
  Fields: 'Fields',
  Key: 'Key',
  Value: 'Value',
  Clamped: 'Clamped',
  Scalar: 'Scalar',
  Code: 'Code',
  Toggle: 'Toggle',
  Count: 'Count',
  Arguments: 'Arguments',
}));
vi.mock('./ApprovalRangeEdit.css', () => ({
  RangeEdit: 'RangeEdit',
  Header: 'Header',
  Target: 'Target',
  Links: 'Links',
  Host: 'Host',
  Scroll: 'Scroll',
  Table: 'Table',
  Cell: 'Cell',
  Value: 'Value',
  Before: 'Before',
  Muted: 'Muted',
  Format: 'Format',
}));

const WEB_URL = 'https://contoso.sharepoint.com/sites/finance/Forecast.xlsx';
const ARGUMENTS = {
  file: '/drives/b!1/items/01X',
  worksheet: 'Q3 Budget',
  address: 'B2:C2',
  values: [['0042', true]],
  expected_formulas: [['', false]],
  expected_web_url: WEB_URL,
  number_formats: [['@', null]],
};

const approvalFor = (content: Record<string, unknown>) =>
  parseToolApprovalContent('io.mindroom.tool_approval', {
    approval_id: 'one',
    tool_name: 'microsoft_files_excel_update_range',
    agent_name: 'assistant',
    status: 'pending',
    requested_at: '2026-11-02T12:00:00Z',
    expires_at: '2026-11-02T12:30:00Z',
    ...content,
  })!;

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));

const render = (approval: ReturnType<typeof approvalFor>) => {
  const i18n = createInstance();
  void i18n.init({ lng: 'en', resources: { en: { translation: en } }, initAsync: false });
  act(() => {
    renderer = create(
      <I18nextProvider i18n={i18n}>
        <ApprovalArguments approval={approval} />
      </I18nextProvider>
    );
  });
  return JSON.stringify(renderer.toJSON());
};

describe('Excel range edit approvals', () => {
  it('show each changed cell before and after, with links to the workbook', () => {
    const text = render(approvalFor({ arguments: ARGUMENTS }));

    expect(text).toContain("'Q3 Budget'!B2:C2");
    for (const part of ['B2', 'empty', '0042', 'Format: @', 'C2', 'FALSE', 'TRUE'])
      expect(text).toContain(part);
    const hrefs = renderer.root.findAllByType('a').map((link) => link.props.href);
    expect(hrefs).toEqual([`ms-excel:ofe|u|${WEB_URL}`, WEB_URL]);
    expect(renderer.root.findByProps({ className: 'Host' }).children).toEqual([
      'contoso.sharepoint.com',
    ]);
    // Right-to-left layouts would otherwise reorder addresses and formulas.
    expect(renderer.root.findByProps({ className: 'Target' }).props.dir).toBe('ltr');
    expect(renderer.root.findAllByType('td').map((cell) => cell.props.dir)).toEqual(
      Array(4).fill('auto')
    );
  });

  it('show both sides exactly when a change would otherwise look unchanged', () => {
    const text = render(
      approvalFor({
        arguments: {
          ...ARGUMENTS,
          address: 'A1:F1',
          values: [[42, true, 'a ', 'empty', 'abc\u200b', 'x\u034f\u{e0041}']],
          expected_formulas: [['42', 'TRUE', 'a', '', 'abc', 'x']],
          number_formats: null,
        },
      })
    );

    for (const shown of [
      '"42"',
      '42',
      '"TRUE"',
      'true',
      '"a"',
      '"a "',
      '""',
      '"empty"',
      '"abc\\u{200b}"',
      '"x\\u{34f}\\u{e0041}"',
    ])
      expect(text).toContain(JSON.stringify(shown).slice(1, -1));
  });

  it('load the complete arguments without a click when the card shows a truncated preview', async () => {
    // A preview can keep the grids whole while dropping number_formats, which would hide format changes.
    const { number_formats: _dropped, ...preview } = ARGUMENTS;
    let resolve: (blob: Blob) => void = () => undefined;
    mocks.download.mockReturnValueOnce(
      new Promise<Blob>((settle) => {
        resolve = settle;
      })
    );
    const approval = approvalFor({
      arguments: preview,
      arguments_truncated: true,
      full_arguments_url: 'mxc://x/y',
    });

    const text = render(approval);
    expect(text).not.toContain('Before');
    expect(text).toContain('Loading complete arguments');

    await act(async () => resolve(new Blob([JSON.stringify(ARGUMENTS)])));
    const loaded = JSON.stringify(renderer.toJSON());
    expect(loaded).toContain('Before');
    expect(loaded).toContain('Format: @');
  });

  it('use complete arguments the card carries next to a truncated preview', () => {
    const text = render(
      approvalFor({
        arguments: { address: 'B2:C2' },
        arguments_truncated: true,
        full_arguments: ARGUMENTS,
      })
    );

    expect(text).toContain('Before');
    expect(text).toContain('0042');
  });

  it('leave other tools to the argument fields', () => {
    const text = render(
      approvalFor({ tool_name: 'microsoft_files_upload_file', arguments: ARGUMENTS })
    );

    expect(text).not.toContain('Before');
  });
});
