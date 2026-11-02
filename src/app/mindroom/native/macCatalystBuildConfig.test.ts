import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { getSingleAppTargetBuildSettingValue } from '../../../../scripts/ios-xcode-project.mjs';

const require = createRequire(import.meta.url);
// Use the same parser as the declared Capacitor CLI dependency.
const requireCapacitor = createRequire(require.resolve('@capacitor/cli/package.json'));
const plist = requireCapacitor('plist');
const xcodeProject = readFileSync(resolve('ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
// Xcode quotes values that contain characters such as `-`.
const appSetting = (name: string) =>
  getSingleAppTargetBuildSettingValue(xcodeProject, name).replace(/^"|"$/g, '');
// Every PNG filter type stores the first pixel of the first row unchanged.
const firstPixelAlpha = (png: Buffer) => {
  const data: Buffer[] = [];
  for (let offset = 8; offset < png.length; offset += png.readUInt32BE(offset) + 12) {
    if (png.toString('latin1', offset + 4, offset + 8) === 'IDAT') {
      data.push(png.subarray(offset + 8, offset + 8 + png.readUInt32BE(offset)));
    }
  }
  return inflateSync(Buffer.concat(data))[4];
};

describe('Mac Catalyst build of the App target', () => {
  it('builds for Mac Catalyst under the iOS bundle ID', () => {
    expect(appSetting('SUPPORTS_MACCATALYST')).toBe('YES');
    // The Mac app shares push, universal links and Sign in with Apple with iOS.
    expect(appSetting('DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER')).toBe('NO');
    expect(appSetting('PRODUCT_BUNDLE_IDENTIFIER')).toBe('chat.mindroom.app');
  });

  it('signs the Mac build with its own entitlements and the hardened runtime', () => {
    expect(appSetting('"CODE_SIGN_ENTITLEMENTS[sdk=macosx*]"')).toBe('App/App-macOS.entitlements');
    // Notarization requires the hardened runtime.
    expect(appSetting('"ENABLE_HARDENED_RUNTIME[sdk=macosx*]"')).toBe('YES');
    expect(appSetting('CODE_SIGN_ENTITLEMENTS')).toBe('App/App.entitlements');
  });

  it('exports with the Developer ID profile for the shared bundle ID', () => {
    expect(
      plist.parse(readFileSync(resolve('ios/App/macos-export-options.plist'), 'utf8'))
    ).toEqual({
      method: 'developer-id',
      teamID: 'DNA6966LGZ',
      signingStyle: 'manual',
      signingCertificate: 'Developer ID Application',
      provisioningProfiles: { 'chat.mindroom.app': 'MindRoom Chat Developer ID' },
    });
  });

  it('supplies every Mac icon size in the macOS shape without changing the iOS icon slots', () => {
    const iconPath = resolve('ios/App/App/Assets.xcassets/AppIcon.appiconset');
    const { images } = JSON.parse(readFileSync(resolve(iconPath, 'Contents.json'), 'utf8'));
    const macImages = images.filter((image: { idiom: string }) => image.idiom === 'mac');
    expect(
      macImages.map(({ size, scale }: { size: string; scale: string }) => [size, scale])
    ).toEqual([
      ['16x16', '1x'],
      ['16x16', '2x'],
      ['32x32', '1x'],
      ['32x32', '2x'],
      ['128x128', '1x'],
      ['128x128', '2x'],
      ['256x256', '1x'],
      ['256x256', '2x'],
      ['512x512', '1x'],
      ['512x512', '2x'],
    ]);
    for (const image of macImages) {
      const png = readFileSync(resolve(iconPath, image.filename));
      const pixels = parseInt(image.size, 10) * parseInt(image.scale, 10);
      expect(png.readUInt32BE(16)).toBe(pixels);
      expect(png.readUInt32BE(20)).toBe(pixels);
      // macOS draws app icons unmasked, so the rounded shape needs transparent corners.
      expect([png[24], png[25]], `${image.filename} must be 8-bit RGBA`).toEqual([8, 6]);
      expect(firstPixelAlpha(png), `${image.filename} must have a transparent corner`).toBe(0);
    }
  });

  it('grants supported Developer ID capabilities and hardened-runtime microphone and camera', () => {
    const entitlements = plist.parse(
      readFileSync(resolve('ios/App/App/App-macOS.entitlements'), 'utf8')
    );
    expect(entitlements).toEqual({
      // development for Debug and production for Release, as App.entitlements does.
      'com.apple.developer.aps-environment': '$(APS_ENVIRONMENT)',
      'com.apple.developer.associated-domains': ['applinks:chat.mindroom.chat'],
      // The hardened runtime blocks the microphone and camera without these.
      'com.apple.security.device.audio-input': true,
      'com.apple.security.device.camera': true,
    });
  });
});
