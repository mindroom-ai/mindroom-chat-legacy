#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
ruby scripts/ios-routing-test-project.rb
cd .claude/evidence/ios-routing
pod install

# Use the runtime of the selected Xcode's SDK: images also carry newer runtimes,
# which stall in data migration on boot under an older Xcode.
sdk_version=$(xcrun --sdk iphonesimulator --show-sdk-version)
device_id=$(xcrun simctl list devices available --json | node --input-type=commonjs -e '
  const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-" + process.argv[1].replace(/\./g, "-");
  let input = "";
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => {
    const devices = JSON.parse(input).devices[runtime] ?? [];
    const phone = devices.find(device => device.name.startsWith("iPhone"));
    if (!phone) throw new Error(`No available iPhone simulator for ${runtime}`);
    process.stdout.write(phone.udid);
  });
' "$sdk_version")

# Finish simulator startup explicitly; Xcode can otherwise stall before XCTest
# starts on a fresh CI runner. Keep a failed boot visible and bounded.
node --input-type=commonjs - "$device_id" <<'NODE'
const { spawnSync } = require('node:child_process');
const result = spawnSync('xcrun', ['simctl', 'bootstatus', process.argv[2], '-b'], {
  stdio: 'inherit',
  timeout: 180_000,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
NODE

# Keep every run, including the failing baseline, as an inspectable result bundle.
# The longest check can use 90s startup + 15s navigation + 10s server + 10s fetch.
# Leave room for XCTest overhead while retaining the hard 240s maximum.
result_name="Routing-$(date -u +%Y%m%dT%H%M%SZ).xcresult"
xcodebuild test \
  -workspace Routing.xcworkspace \
  -scheme Routing \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$device_id" \
  -parallel-testing-enabled NO \
  -test-timeouts-enabled YES \
  -default-test-execution-time-allowance 180 \
  -maximum-test-execution-time-allowance 240 \
  -derivedDataPath DerivedData \
  -resultBundlePath "$result_name" \
  CODE_SIGNING_ALLOWED=NO 2>&1 | tee xcodebuild.log
