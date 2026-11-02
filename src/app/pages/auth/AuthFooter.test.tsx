import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import es from '../../locales/es.json';
import { ClientConfigProvider, type ClientConfig } from '../../hooks/useClientConfig';
import { AuthFooter } from './AuthFooter';

vi.mock('./styles.css', () => ({ AuthFooter: 'auth-footer' }));
vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
}));

const renderFooter = (config: ClientConfig) =>
  renderToStaticMarkup(
    <ClientConfigProvider value={config}>
      <AuthFooter />
    </ClientConfigProvider>
  );

const link = (label: string, url: string, dir = ' dir="auto"') =>
  `<a href="${url}" target="_blank" rel="noreferrer"${dir}>${label}</a>`;

describe('AuthFooter', () => {
  it('credits MindRoom Chat, Matrix, and Cinny by default', () => {
    expect(renderFooter({})).toContain(
      `<p>Powered by ${link(
        'MindRoom Chat',
        'https://github.com/mindroom-ai/mindroom-chat'
      )}, ${link('Matrix', 'https://matrix.org')}, and ${link(
        'Cinny',
        'https://github.com/ajbura/cinny'
      )}</p>`
    );
  });

  it('credits the configured links instead of the defaults', () => {
    expect(
      renderFooter({
        auth: {
          poweredBy: [
            { label: 'Acme', url: 'https://acme.test' },
            { label: 'Matrix', url: 'https://matrix.org' },
          ],
        },
      })
    ).toContain(
      `<p>Powered by ${link('Acme', 'https://acme.test')} and ${link(
        'Matrix',
        'https://matrix.org'
      )}</p>`
    );
  });

  it('drops the credit line but keeps the policy links when the list is empty', () => {
    const html = renderFooter({
      auth: { poweredBy: [], supportUrl: 'https://support.test' },
    });

    expect(html).not.toContain('Powered by');
    expect(html).toContain(link('Support', 'https://support.test', ''));
  });

  it('joins the links the way the app language lists them', async () => {
    i18next.addResourceBundle('es', 'translation', es);
    await i18next.changeLanguage('es');
    try {
      expect(
        renderFooter({
          auth: {
            poweredBy: [
              { label: 'Acme', url: 'https://acme.test' },
              { label: 'Matrix', url: 'https://matrix.org' },
              { label: 'Inkscape', url: 'https://inkscape.org' },
            ],
          },
        })
      ).toContain(
        `<p>Con tecnología de ${link('Acme', 'https://acme.test')}, ${link(
          'Matrix',
          'https://matrix.org'
        )} e ${link('Inkscape', 'https://inkscape.org')}</p>`
      );
    } finally {
      await i18next.changeLanguage('en');
    }
  });
});
