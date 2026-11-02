import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const bridgeSource = readSource('../../../../ios/App/App/MindRoomBridgeViewController.swift');
const sceneSource = readSource('../../../../ios/App/App/SceneDelegate.swift');
const capacitorConfigSource = readSource('../../../../capacitor.config.ts');

describe('Mac Catalyst shell', () => {
  it('loads the app as a desktop page on Mac only', () => {
    const configuration = bridgeSource.match(
      /override func webViewConfiguration\(for [\s\S]*?\n {4}\}/
    )?.[0];
    expect(
      configuration,
      'MindRoomBridgeViewController must override webViewConfiguration'
    ).toBeDefined();
    expect(configuration).toMatch(/super\.webViewConfiguration\(for:/);
    // Compile-time check: `isMacCatalystApp` is also true for the App Store iPad
    // app on Apple silicon Macs, which must keep the mobile content mode.
    expect(configuration).toMatch(
      /#if targetEnvironment\(macCatalyst\)\s*\w+\.defaultWebpagePreferences\.preferredContentMode = \.desktop\s*#endif/
    );
    expect(configuration).not.toMatch(/ProcessInfo\.processInfo\.isMacCatalystApp/);
    // iPhone and iPad keep the configured mobile content mode.
    expect(capacitorConfigSource).toMatch(/preferredContentMode: 'mobile'/);
  });

  it('keeps the Mac window large enough for the app', () => {
    expect(sceneSource).toMatch(
      /#if targetEnvironment\(macCatalyst\)\s*windowScene\.sizeRestrictions\?\.minimumSize = CGSize\(width: 400, height: 500\)\s*#endif/
    );
  });
  it('uses browser Apple SSO on Catalyst and keeps native authorization for iOS', () => {
    const authSource = readSource('../../../../ios/App/App/MindRoomAuthPlugin.swift');
    const appleMethod = authSource.match(
      /@objc func signInWithApple[\s\S]*?(?= {4}public func presentationAnchor)/
    )?.[0];
    expect(appleMethod).toMatch(
      /#if targetEnvironment\(macCatalyst\)\s*authenticate\(call\)\s*#else[\s\S]*ASAuthorizationAppleIDProvider[\s\S]*#endif/
    );
  });
});
