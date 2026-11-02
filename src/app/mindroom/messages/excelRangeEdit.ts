// Reads a MindRoom `microsoft_files_excel_update_range` approval's arguments as a per-cell before/after review.

export const EXCEL_RANGE_EDIT_TOOL = 'microsoft_files_excel_update_range';

export type ExcelCellValue = string | number | boolean;

export type ExcelCellChange = {
  cell: string;
  before: ExcelCellValue;
  // null keeps the cell's value; only its number format changes.
  after: ExcelCellValue | null;
  numberFormat: string | null;
};

export type ExcelRangeEditReview = {
  worksheet: string;
  address: string;
  // The workbook's address in SharePoint or OneDrive for work or school; null for any other address an agent passed.
  webUrl: string | null;
  changes: ExcelCellChange[];
  unchangedCount: number;
};

// The backend's redaction placeholder: two different secrets redact to the same text.
const REDACTED = '***redacted***';
const ADDRESS = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})(?::\$?([A-Za-z]{1,3})\$?(\d{1,7}))?$/;

const columnNumber = (letters: string): number =>
  [...letters.toUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);

const columnLetters = (column: number): string => {
  let letters = '';
  for (let rest = column; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }
  return letters;
};

const isCell = (value: unknown): value is ExcelCellValue =>
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

const grid = <T>(
  value: unknown,
  rows: number,
  columns: number,
  isItem: (item: unknown) => item is T
): T[][] | null =>
  Array.isArray(value) &&
  value.length === rows &&
  value.every((row) => Array.isArray(row) && row.length === columns && row.every(isItem))
    ? (value as T[][])
    : null;

const isNull = (value: unknown): value is null => value === null;
const isValue = (value: unknown): value is ExcelCellValue | null => isNull(value) || isCell(value);
const isFormat = (value: unknown): value is string | null =>
  isNull(value) || typeof value === 'string';

const workbookUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const trusted = url.hostname.toLowerCase().endsWith('.sharepoint.com');
    // `|` separates Office URI arguments, so an encoded address cannot add arguments to the desktop link.
    const href = url.href.replace(/\|/g, '%7C');
    return url.protocol === 'https:' && !url.username && !url.password && trusted ? href : null;
  } catch {
    return null;
  }
};

// Equal only when nothing hides a difference: same type and value, and no redacted text on either side.
// Matrix carries floats and integers past 2**53 - 1 as text, so such a number and its text compare equal here; the backend leaves equal cells
// unwritten and refuses a change between a number and the same text, so a cell shown unchanged is never written.
const unchanged = (before: ExcelCellValue, after: ExcelCellValue): boolean =>
  typeof before === typeof after &&
  before === after &&
  !(typeof after === 'string' && after.includes(REDACTED));

export function parseExcelRangeEdit(
  toolName: string,
  args: Record<string, unknown> | undefined
): ExcelRangeEditReview | null {
  if (toolName !== EXCEL_RANGE_EDIT_TOOL || !args) return null;
  const { worksheet, address } = args;
  if (typeof worksheet !== 'string' || typeof address !== 'string') return null;
  const match = ADDRESS.exec(address.trim());
  if (!match) return null;
  const [firstRow, firstColumn] = [Number(match[2]), columnNumber(match[1])];
  const [lastRow, lastColumn] = [
    Number(match[4] ?? firstRow),
    match[3] ? columnNumber(match[3]) : firstColumn,
  ];
  const rows = Math.abs(lastRow - firstRow) + 1;
  const columns = Math.abs(lastColumn - firstColumn) + 1;
  const values = grid(args.values, rows, columns, isValue);
  const before = grid(args.expected_formulas, rows, columns, isCell);
  const formats =
    args.number_formats === undefined || args.number_formats === null
      ? null
      : grid(args.number_formats, rows, columns, isFormat);
  if (!values || !before || (args.number_formats != null && !formats)) return null;
  const top = Math.min(firstRow, lastRow);
  const left = Math.min(firstColumn, lastColumn);
  const changes: ExcelCellChange[] = [];
  values.forEach((cells, row) =>
    cells.forEach((after, column) => {
      const numberFormat = formats?.[row][column] ?? null;
      const previous = before[row][column];
      if (numberFormat === null && (after === null || unchanged(previous, after))) return;
      changes.push({
        cell: `${columnLetters(left + column)}${top + row}`,
        before: previous,
        after,
        numberFormat,
      });
    })
  );
  return {
    worksheet,
    address: address.trim(),
    webUrl: workbookUrl(args.expected_web_url),
    changes,
    unchangedCount: rows * columns - changes.length,
  };
}

// Opens the workbook for editing in desktop Excel, where Excel is installed.
export const excelDesktopUrl = (webUrl: string): string => `ms-excel:ofe|u|${webUrl}`;
