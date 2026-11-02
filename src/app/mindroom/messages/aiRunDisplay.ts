import type { TFunction } from 'i18next';
import { MindroomAiRunInfo } from './aiRun';

export const formatMindroomAiRunNumber = (
  value: number | undefined,
  locale?: string
): string | undefined =>
  typeof value === 'number' ? Math.round(value).toLocaleString(locale) : undefined;

export const formatMindroomAiRunTimeToFirstToken = (
  value: number | undefined
): string | undefined => {
  if (typeof value !== 'number' || value < 0) return undefined;
  return `${Math.round(value * 1000)} ms`;
};

/** A USD amount sized for per-reply costs: cents from $0.10 up, two significant digits below. */
export const formatMindroomCostUsd = (usd: number, locale?: string): string => {
  const currency = (options: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', ...options });
  if (usd === 0) return currency({ minimumFractionDigits: 2 }).format(0);
  // Rounding decides the style, so $0.0999 reads $0.10, not $0.1.
  if (Number(usd.toPrecision(2)) >= 0.1) {
    return currency({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usd);
  }
  return currency({ maximumSignificantDigits: 2 }).format(usd);
};

/** A share of a bar, such as 82.6 %, in the reader's number style. */
export const formatMindroomAiRunPercentage = (percentage: number, locale?: string): string =>
  new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(percentage / 100);

type MindroomAiRunTokenPart = {
  key: 'cacheRead' | 'newInput' | 'input' | 'output';
  label: string;
  tokens: number;
  percentage: number;
};

type MindroomAiRunContextBarSegment = MindroomAiRunTokenPart & {
  key: 'cacheRead' | 'newInput' | 'input';
};

const TOKEN_PART_LABELS = {
  cacheRead: ['mindroomUi.messages.mindroomReplyDetails.fromCache', 'From cache'],
  newInput: ['mindroomUi.messages.mindroomReplyDetails.newInput', 'New input'],
  input: ['mindroomUi.messages.mindroomReplyDetails.input', 'Input'],
  output: ['mindroomUi.messages.mindroomReplyDetails.output', 'Output'],
} as const;

const tokenPartLabel = (key: MindroomAiRunTokenPart['key'], t?: TFunction): string => {
  const [labelKey, fallback] = TOKEN_PART_LABELS[key];
  return t ? t(labelKey) : fallback;
};

/** What a reply's tokens were spent on; input splits by cache only where the backend reported the split. */
export const getMindroomAiRunTokenParts = (
  info: MindroomAiRunInfo,
  t?: TFunction
): { total: number; parts: MindroomAiRunTokenPart[] } | undefined => {
  const counts: [MindroomAiRunTokenPart['key'], number | undefined][] =
    info.uncachedInputTokens === undefined
      ? [
          ['input', info.inputTokens],
          ['output', info.outputTokens],
        ]
      : [
          ['cacheRead', info.cacheReadTokens],
          ['newInput', info.uncachedInputTokens],
          ['output', info.outputTokens],
        ];
  const used = counts.filter((entry): entry is [MindroomAiRunTokenPart['key'], number] => {
    const tokens = entry[1];
    return tokens !== undefined && tokens > 0;
  });
  const total = used.reduce((sum, [, tokens]) => sum + tokens, 0);
  if (total <= 0) return undefined;
  return {
    total,
    parts: used.map(([key, tokens]) => ({
      key,
      label: tokenPartLabel(key, t),
      tokens,
      percentage: (tokens / total) * 100,
    })),
  };
};

export const getMindroomAiRunModelLabel = (info: MindroomAiRunInfo): string | undefined => {
  const providerAndId = [info.modelProvider, info.modelId].filter(Boolean).join(' / ');
  if (info.modelConfig && providerAndId) return `${info.modelConfig} (${providerAndId})`;
  if (info.modelConfig) return info.modelConfig;
  return providerAndId || undefined;
};

const GENERIC_MODEL_CONFIGS = new Set(['auto', 'default']);

const titleCaseWords = (value: string): string =>
  value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');

const formatModelId = (modelId: string): string => {
  const claudeMatch = modelId.match(/claude-(?:\d+(?:[-.]\d+)*-)?(opus|sonnet|haiku)(?:-(.*))?/i);
  if (claudeMatch) {
    const family = titleCaseWords(claudeMatch[1]);
    const version = claudeMatch[2]?.replace(/-/g, '.').replace(/(?:^|\.)latest$/i, '');
    return version ? `${family} ${version}` : family;
  }

  if (/^gpt-/i.test(modelId)) return modelId.replace(/^gpt/i, 'GPT');
  return titleCaseWords(modelId.replace(/-/g, ' '));
};

/** A short, friendly model name intended for the always-visible message badge. */
export const getMindroomAiRunCompactModelLabel = (info: MindroomAiRunInfo): string | undefined => {
  if (info.modelDisplayName) return info.modelDisplayName;

  const modelConfig = info.modelConfig?.trim();
  if (modelConfig && !GENERIC_MODEL_CONFIGS.has(modelConfig.toLowerCase())) {
    return titleCaseWords(modelConfig);
  }

  const modelId = info.modelId?.trim();
  if (modelId) return formatModelId(modelId);

  const provider = info.modelProvider?.trim();
  return provider ? titleCaseWords(provider) : undefined;
};

const isValidContextBarTokenCount = (value: number | undefined): value is number =>
  typeof value === 'number' && value >= 0;

/** How much of the model's context window the reply's last request filled. */
export const getMindroomAiRunContextLabel = (
  info: MindroomAiRunInfo,
  t?: TFunction,
  locale?: string
): string | undefined => {
  const inputTokens = info.contextInputTokens;
  const windowTokens = info.contextWindowTokens;
  if (inputTokens === undefined || windowTokens === undefined || windowTokens <= 0) {
    return undefined;
  }

  const percentage = formatMindroomAiRunPercentage((inputTokens / windowTokens) * 100, locale);
  const input = formatMindroomAiRunNumber(inputTokens, locale);
  const window = formatMindroomAiRunNumber(windowTokens, locale);
  return t
    ? t('mindroomUi.messages.mindroomReplyDetails.contextWindowUsage', {
        input,
        window,
        percentage,
      })
    : `${input} of ${window} · ${percentage}`;
};

export const getMindroomAiRunContextBarSegments = (
  info: MindroomAiRunInfo,
  t?: TFunction
): MindroomAiRunContextBarSegment[] | undefined => {
  const inputTokens = info.contextInputTokens;
  const windowTokens = info.contextWindowTokens;
  const cacheReadTokens = info.contextCacheReadInputTokens;
  const uncachedTokens = info.contextUncachedInputTokens;

  if (
    !isValidContextBarTokenCount(inputTokens) ||
    !isValidContextBarTokenCount(windowTokens) ||
    windowTokens <= 0 ||
    inputTokens > windowTokens
  ) {
    return undefined;
  }

  // Without a cache count the split is unknown, so the bar shows the input as one part.
  if (!isValidContextBarTokenCount(cacheReadTokens)) {
    return [
      {
        key: 'input',
        label: tokenPartLabel('input', t),
        tokens: inputTokens,
        percentage: (inputTokens / windowTokens) * 100,
      },
    ];
  }

  const displayedCacheReadTokens = Math.min(cacheReadTokens, inputTokens);
  const displayedUncachedTokens =
    isValidContextBarTokenCount(uncachedTokens) && cacheReadTokens + uncachedTokens === inputTokens
      ? uncachedTokens
      : inputTokens - displayedCacheReadTokens;
  return [
    {
      key: 'cacheRead',
      label: tokenPartLabel('cacheRead', t),
      tokens: displayedCacheReadTokens,
      percentage: (displayedCacheReadTokens / windowTokens) * 100,
    },
    {
      key: 'newInput',
      label: tokenPartLabel('newInput', t),
      tokens: displayedUncachedTokens,
      percentage: (displayedUncachedTokens / windowTokens) * 100,
    },
  ];
};
