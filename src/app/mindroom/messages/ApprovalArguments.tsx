import { useTranslation } from 'react-i18next';
import React, { useEffect, useState } from 'react';
import { Button, Icon, Icons, Text } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { ToolApprovalData } from './toolApproval';
import { downloadMindroomSidecarBlob } from './sidecarDownload';
import { ApprovalArgumentFields, countArgumentFields } from './ApprovalArgumentFields';
import { ApprovalRangeEdit } from './ApprovalRangeEdit';
import { EXCEL_RANGE_EDIT_TOOL, parseExcelRangeEdit } from './excelRangeEdit';
import * as css from './ApprovalArgumentFields.css';

const PREVIEW_FIELDS = 3;

export function ApprovalArguments({ approval }: { approval: ToolApprovalData }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<{ sourceKey: string; value: Record<string, unknown> }>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const sourceKey = JSON.stringify(approval.argumentSource);
  const complete =
    approval.fullArguments ?? (loaded?.sourceKey === sourceKey ? loaded.value : undefined);
  // An Excel edit's review table needs the complete arguments, so they load without a click.
  const rangeTool = approval.toolName === EXCEL_RANGE_EDIT_TOOL;
  useEffect(() => {
    let active = true;
    // Parsing replaces objects on every room update; attachment identity stays fixed.
    const source = JSON.parse(sourceKey) as ToolApprovalData['argumentSource'];
    if ((!open && !rangeTool) || complete || !source) return undefined;
    setError(false);
    void downloadMindroomSidecarBlob(mx, source)
      .then(async (blob) => {
        const value: unknown = JSON.parse(await blob.text());
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('Invalid argument attachment');
        if (active) setLoaded({ sourceKey, value: value as Record<string, unknown> });
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [mx, open, rangeTool, complete, sourceKey, retry]);
  const shown = complete ?? approval.arguments;
  const total = countArgumentFields(shown);
  // A truncated preview could hide changed cells, so the table waits for the complete arguments.
  const rangeEdit = parseExcelRangeEdit(
    approval.toolName,
    complete ?? (approval.argumentsTruncated ? undefined : approval.arguments)
  );
  const status = approval.argumentsTruncated && !complete && (
    <p>
      {error
        ? t('mindroomUi.messages.approvalArguments.loadFailed')
        : approval.argumentSource
        ? t('mindroomUi.messages.approvalArguments.loadingCompleteArguments')
        : t('mindroomUi.messages.approvalArguments.onlyATruncatedPreviewIsAvailable')}
      {error && (
        <button type="button" onClick={() => setRetry((value) => value + 1)}>
          {t('mindroomUi.messages.approvalArguments.retry')}
        </button>
      )}
    </p>
  );
  return (
    <div className={css.Arguments}>
      {rangeTool && status}
      {rangeEdit && <ApprovalRangeEdit review={rangeEdit} />}
      {!open && <ApprovalArgumentFields value={approval.arguments} limit={PREVIEW_FIELDS} />}
      <Button
        type="button"
        size="300"
        variant="Secondary"
        fill="Soft"
        radii="300"
        className={css.Toggle}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        before={<Icon size="50" src={open ? Icons.ChevronTop : Icons.ChevronBottom} />}
        outlined
      >
        <Text size="B300">
          {open
            ? t('mindroomUi.messages.approvalArguments.hideArguments')
            : t('mindroomUi.messages.approvalArguments.showAllArguments')}
        </Text>
        {!open && total > 0 && !approval.argumentsTruncated && (
          <Text size="B300" className={css.Count}>
            {total}
          </Text>
        )}
      </Button>
      {open && (
        <>
          {!rangeTool && status}
          <ApprovalArgumentFields value={shown} />
          <small>{t('mindroomUi.messages.approvalArguments.sensitiveValuesMayBeRedacted')}</small>
        </>
      )}
    </div>
  );
}
