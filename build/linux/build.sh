#!/bin/sh
# Builds dist/klats_amd64.deb and dist/Klats-x86_64.AppImage from one x86_64
# binary, and leaves the binary in dist/klats. Needs Ubuntu 24.04 with Go,
# pnpm, curl, dpkg-deb and the GTK 4 and WebKitGTK 6.0 development packages
# (libgtk-4-dev, libwebkitgtk-6.0-dev). Both packages run on the system's
# GTK 4 and WebKitGTK 6.0, and the AppImage bundles no libraries, so they need
# a system no older than the one the binary was built on. It works from the
# repository root, so it can be started from anywhere.
#
# Usage: build/linux/build.sh VERSION
# VERSION has no leading "v", such as 1.2.3 or 0.1.0-rc.1. It is stamped into
# the binary as main.version and into the .deb's control file.
set -eu

if [ $# -ne 1 ]; then
	echo "usage: $0 VERSION" >&2
	exit 2
fi
version=$1
cd "$(dirname "$0")/../.."

make web
mkdir -p dist
go build -tags production -trimpath -ldflags "-s -w -X main.version=$version" -o dist/klats ./cmd/klats

# The menu and MIME caches update through the dpkg triggers of
# desktop-file-utils and shared-mime-info, so the .deb has no maintainer scripts.
deb=dist/deb
rm -rf "$deb"
install -Dm755 dist/klats "$deb/usr/bin/klats"
install -Dm644 build/linux/klats.desktop "$deb/usr/share/applications/klats.desktop"
install -Dm644 build/icon/klats.svg "$deb/usr/share/icons/hicolor/scalable/apps/klats.svg"
install -Dm644 build/icon/klats-256.png "$deb/usr/share/icons/hicolor/256x256/apps/klats.png"
install -Dm644 build/linux/klats-mime.xml "$deb/usr/share/mime/packages/klats.xml"
mkdir "$deb/DEBIAN"
# Semver's "-" before a pre-release becomes "~": dpkg sorts 1.2.3~rc.1 before
# 1.2.3, as semver does, while 1.2.3-rc.1 would read as a Debian revision of
# 1.2.3 and sort after it.
sed "s/@VERSION@/$(printf %s "$version" | tr - '~')/" build/linux/control.in >"$deb/DEBIAN/control"
dpkg-deb --root-owner-group --build "$deb" dist/klats_amd64.deb

# appimagetool 1.9.0, and the AppImage runtime it puts at the front of the
# AppImage, each checked against its release asset's SHA-256. Without
# --runtime-file, appimagetool downloads the runtime's "continuous" build,
# which changes under the same URL.
tools=dist/appimagetool
rm -rf "$tools"
mkdir "$tools"
curl -fsSL --retry 3 -o "$tools/appimagetool" \
	https://github.com/AppImage/appimagetool/releases/download/1.9.0/appimagetool-x86_64.AppImage
curl -fsSL --retry 3 -o "$tools/runtime" \
	https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64
sha256sum -c - <<EOF
46fdd785094c7f6e545b61afcfb0f3d98d8eab243f644b4b17698c01d06083d1  $tools/appimagetool
2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d  $tools/runtime
EOF
chmod +x "$tools/appimagetool"

appdir=dist/AppDir
rm -rf "$appdir"
mkdir "$appdir"
cp -R "$deb/usr" "$appdir/usr"
install -m755 build/linux/AppRun "$appdir/AppRun"
cp build/linux/klats.desktop "$appdir/klats.desktop"
cp build/icon/klats-256.png "$appdir/klats.png"
# --appimage-extract-and-run unpacks appimagetool into /tmp and runs it from
# there, so the build needs no FUSE.
ARCH=x86_64 "$tools/appimagetool" --appimage-extract-and-run --runtime-file "$tools/runtime" \
	"$appdir" dist/Klats-x86_64.AppImage

rm -rf "$deb" "$appdir" "$tools"
