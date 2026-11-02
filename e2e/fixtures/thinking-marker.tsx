import React from 'react';
import { createRoot } from 'react-dom/client';
import { color, configClass, varsClass } from 'folds';
import '@fontsource/inter/variable.css';
import 'folds/dist/style.css';
import '../../src/index.css';
import '../../src/app/i18n';
import { darkTheme, lightTheme } from '../../src/colors.css';
import { ClientConfigProvider } from '../../src/app/hooks/useClientConfig';
import { MindroomThinkingPlaceholder } from '../../src/app/mindroom/messages/MindroomThinkingPlaceholder';

const params = new URLSearchParams(window.location.search);
const dark = params.has('dark');
const label = params.get('label') ?? 'Thinking...';
const elapsed = params.get('elapsed');
const startedAt = elapsed === null ? undefined : Date.now() - Number(elapsed);
document.documentElement.className = `${configClass} ${varsClass} ${dark ? darkTheme : lightTheme}`;
document.documentElement.dir = params.has('rtl') ? 'rtl' : 'ltr';

createRoot(document.getElementById('root')!).render(
  <ClientConfigProvider value={{ mindroom: { thinkingPlaceholderMessages: [label] } }}>
    <main
      style={{
        padding: 24,
        color: color.Surface.OnContainer,
        background: color.Surface.Container,
        minHeight: '100vh',
        lineHeight: 1.5,
      }}
    >
      <p style={{ fontSize: 16 }}>
        <MindroomThinkingPlaceholder startedAt={startedAt} />
      </p>
      <p style={{ fontSize: 14 }}>
        <MindroomThinkingPlaceholder startedAt={startedAt} />
      </p>
    </main>
  </ClientConfigProvider>
);
