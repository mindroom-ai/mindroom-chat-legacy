import { createInstance } from 'i18next';
import { expect, it } from 'vitest';

// patches/i18next+23.12.2.patch backports i18next 26.5's interpolation fix.
it('inserts an escaped value that contains its own placeholder once', async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: { joined: '<b>{{userName}}</b> joined the room' } } },
  });

  // Escaping lengthens "/" and "&"; when it adds more than the text after the inner
  // placeholder, the scan resumed inside the inserted value and inserted it again,
  // up to 1000 times.
  expect(
    i18n.t('joined', {
      userName: 'Maya////$&{{userName}}',
      interpolation: { escapeValue: true },
    })
  ).toBe('<b>Maya&#x2F;&#x2F;&#x2F;&#x2F;$&amp;{{userName}}</b> joined the room');
});
