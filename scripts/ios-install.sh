#!/usr/bin/env bash
#
# Build the phone companion and put it on a connected iPhone.
#
#   ./scripts/ios-install.sh [device-udid]
#
# Why this is not just `tauri ios build`:
#
# iOS 26 made the UIScene lifecycle mandatory. UIKit checks the SDK version
# recorded in the binary, and for anything built against iOS 26 or newer it
# traps at launch unless the app adopted scenes
# (UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption). Tauri reaches
# UIKit through tao, and tao has no UIScene support in any released version,
# 0.37 included, so every Tauri app built with Xcode 26+ dies before any of our
# own code runs.
#
# Until tao adopts scenes, this rewrites the recorded SDK back to 18.0 so the
# check treats the app as pre-scene and leaves it alone. Only the version
# stamped in LC_BUILD_VERSION changes; the app is still compiled against the
# current SDK. Rewriting the header invalidates the signature, so it is signed
# again afterwards.
#
# Revisit this once tao ships UIScene support: drop the vtool/codesign steps
# and go back to plain `tauri ios build`.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
APP_SRC="$ROOT/src-tauri/gen/apple/build/solidlocker_iOS.xcarchive/Products/Applications/SolidLocker.app"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

export PATH="$HOME/.cargo/bin:$PATH"

DEVICE="${1:-}"
if [ -z "$DEVICE" ]; then
  DEVICE=$(xcrun devicectl list devices 2>/dev/null \
    | awk '/available|connected/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) {print $i; exit}}')
fi
if [ -z "$DEVICE" ]; then
  echo "No iPhone found. Pass the UDID: ./scripts/ios-install.sh <udid>" >&2
  echo "Devices currently visible:" >&2
  xcrun devicectl list devices >&2
  exit 1
fi
echo "==> device $DEVICE"

echo "==> building"
npm run tauri ios build -- --debug --target aarch64

echo "==> patching recorded SDK 27.0 -> 18.0 (UIScene workaround)"
ditto "$APP_SRC" "$WORK/SolidLocker.app"
APP="$WORK/SolidLocker.app"
codesign -d --entitlements :- "$APP_SRC" > "$WORK/ent.plist" 2>/dev/null

# ditto carries extended attributes across, and codesign refuses to sign a
# bundle that still has them.
xattr -cr "$APP"
xcrun vtool -set-build-version ios 15.0 18.0 -replace \
  -output "$APP/SolidLocker.tmp" "$APP/SolidLocker" 2>/dev/null
mv "$APP/SolidLocker.tmp" "$APP/SolidLocker"
chmod +x "$APP/SolidLocker"
xattr -cr "$APP"

IDENTITY=$(security find-identity -v -p codesigning \
  | awk '/Apple Development/ {print $2; exit}')
if [ -z "$IDENTITY" ]; then
  echo "No 'Apple Development' signing identity in the keychain." >&2
  echo "Sign in under Xcode > Settings > Accounts, then build once in Xcode." >&2
  exit 1
fi
echo "==> signing with $IDENTITY"
codesign --force --sign "$IDENTITY" --entitlements "$WORK/ent.plist" "$APP"
codesign -v "$APP"

echo "==> installing"
xcrun devicectl device install app --device "$DEVICE" "$APP"

echo "==> launching"
xcrun devicectl device process launch --device "$DEVICE" com.solidlocker.app

echo
echo "Done. Free-provisioning signatures last 7 days; rerun this to renew."
