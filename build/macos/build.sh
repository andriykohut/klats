#!/bin/sh
# Builds dist/Klats.dmg, which holds a universal (Apple Silicon and Intel)
# Klats.app beside a link to /Applications, and leaves the app itself in
# dist/Klats.app. Needs macOS with the Xcode command line tools, Go and pnpm.
# It works from the repository root, so it can be started from anywhere.
#
# Usage: build/macos/build.sh VERSION
# VERSION has no leading "v", such as 1.2.3 or 0.1.0-rc.1. It is stamped into
# the binary as main.version and into Info.plist as the bundle's version.
set -eu

if [ $# -ne 1 ]; then
	echo "usage: $0 VERSION" >&2
	exit 2
fi
version=$1
cd "$(dirname "$0")/../.."

make web

# The Makefile explains these: they hold every object to Info.plist's
# LSMinimumSystemVersion, overriding Wails' 10.13 and the SDK's default.
export MACOSX_DEPLOYMENT_TARGET=13.0
min=-mmacosx-version-min=13.0
ldflags="-s -w -X main.version=$version"
mkdir -p dist
# The Intel build's CGO_CFLAGS repeats Go's default -O2 -g, which setting it would drop.
GOARCH=arm64 CGO_ENABLED=1 CGO_LDFLAGS="$min" \
	go build -tags production -trimpath -ldflags "$ldflags" -o dist/klats-arm64 ./cmd/klats
GOARCH=amd64 CGO_ENABLED=1 CC="clang -arch x86_64" CGO_CFLAGS="-O2 -g -arch x86_64" CGO_LDFLAGS="-arch x86_64 $min" \
	go build -tags production -trimpath -ldflags "$ldflags" -o dist/klats-amd64 ./cmd/klats

app=dist/Klats.app
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
lipo -create dist/klats-arm64 dist/klats-amd64 -output "$app/Contents/MacOS/klats"
rm dist/klats-arm64 dist/klats-amd64
cp build/icon/klats.icns build/icon/klats-file.icns "$app/Contents/Resources/"
sed "s/@VERSION@/$version/g" build/macos/Info.plist.in >"$app/Contents/Info.plist"
# Ad hoc, so macOS reports an unidentified developer rather than a damaged app.
codesign --force --deep -s - "$app"

stage=dist/dmg
rm -rf "$stage"
mkdir "$stage"
ditto "$app" "$stage/Klats.app"
ln -s /Applications "$stage/Applications"
hdiutil create -volname "Клац" -srcfolder "$stage" -format UDZO -ov dist/Klats.dmg
rm -rf "$stage"
