package mtf_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io/fs"
	"math/rand/v2"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"klats/internal/media"
	"klats/internal/mtf"
	"klats/internal/mtf/mtftest"
	"klats/internal/testfmt"
)

func store(t testing.TB) (*media.Store, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "media")
	ms, err := media.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	return ms, dir
}

// jpg returns a 3×2 JPEG.
func jpg() []byte {
	var b bytes.Buffer
	_ = jpeg.Encode(&b, image.NewRGBA(image.Rect(0, 0, 3, 2)), nil)
	return b.Bytes()
}

func TestStorePictureJPEG(t *testing.T) {
	ms, _ := store(t)
	data := jpg()
	sum := sha256.Sum256(data)
	want := testfmt.Image{Src: hex.EncodeToString(sum[:]) + ".jpg", W: 3, H: 2}
	if got, ok, err := mtf.StorePicture(ms, data); got != want || !ok || err != nil {
		t.Errorf("storePicture = %+v, %v, %v; want %+v, true, nil", got, ok, err, want)
	}
}

func TestStorePictureBMP(t *testing.T) {
	ms, dir := store(t)
	got, ok, err := mtf.StorePicture(ms, mtftest.BMP(5, 4))
	if !strings.HasSuffix(got.Src, ".png") || got.W != 5 || got.H != 4 || !ok || err != nil {
		t.Fatalf("storePicture = %+v, %v, %v; want a 5×4 PNG", got, ok, err)
	}
	f, err := os.Open(filepath.Join(dir, got.Src))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	m, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	if c := color.RGBAModel.Convert(m.At(0, 0)); c != (color.RGBA{255, 0, 0, 255}) {
		t.Errorf("top-left pixel = %v, want red", c)
	}
}

func TestStorePictureRejects(t *testing.T) {
	noise := make([]byte, 1000)
	_, _ = rand.NewChaCha8([32]byte{1}).Read(noise)
	var wide bytes.Buffer
	_ = png.Encode(&wide, image.NewGray(image.Rect(0, 0, 10001, 1)))
	// A header claiming 10000×10000 pixels in a file of 58 bytes, which the
	// decoder would make room for before reading a row.
	huge := mtftest.BMP(1, 1)
	binary.LittleEndian.PutUint32(huge[18:], 10000)
	binary.LittleEndian.PutUint32(huge[22:], 10000)
	for name, data := range map[string][]byte{
		"noise":           noise,
		"10001 px wide":   wide.Bytes(),
		"over 5 MiB":      append(jpg(), make([]byte, 5<<20)...),
		"pixels left out": huge,
	} {
		ms, _ := store(t)
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		got, ok, err := mtf.StorePicture(ms, data)
		runtime.ReadMemStats(&after)
		if ok || err != nil {
			t.Errorf("%s: storePicture = %+v, %v, %v; want false, nil", name, got, ok, err)
		}
		if n := after.TotalAlloc - before.TotalAlloc; n > 64<<20 {
			t.Errorf("%s: storePicture allocated %d MiB", name, n>>20)
		}
	}
}

func TestStorePictureStoreFailure(t *testing.T) {
	ms, dir := store(t)
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}
	if _, _, err := mtf.StorePicture(ms, jpg()); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("storePicture = %v, want the store's error", err)
	}
}

func TestPictWMF(t *testing.T) {
	ms, _ := store(t)
	bmp := mtftest.BMP(5, 4)
	want, ok, err := mtf.StorePicture(ms, bmp)
	if !ok || err != nil {
		t.Fatalf("storePicture = %+v, %v, %v; want the BMP stored", want, ok, err)
	}
	for _, c := range []struct {
		name string
		wmf  []byte
		want testfmt.Image
	}{
		{"placeable", mtftest.WMF(bmp, true, 0x0F43), want},
		{"no placeable header", mtftest.WMF(bmp, false, 0x0F43), want},
		{"DIBStretchBlt", mtftest.WMF(bmp, true, 0x0B41), want},
		{"no bitmap", mtftest.WMF(bmp, true, 0), testfmt.Image{}},
	} {
		got, ok, err := mtf.PictPicture(ms, mtf.Pict{Kind: "wmetafile", Data: c.wmf})
		if got != c.want || ok != (c.want != testfmt.Image{}) || err != nil {
			t.Errorf("%s: pictPicture = %+v, %v, %v; want %+v", c.name, got, ok, err, c.want)
		}
	}
}

func TestPictJPEGBlip(t *testing.T) {
	ms, _ := store(t)
	if got, ok, err := mtf.PictPicture(ms, mtf.Pict{Kind: "jpegblip", Data: jpg()}); !strings.HasSuffix(got.Src, ".jpg") || !ok || err != nil {
		t.Errorf("pictPicture = %+v, %v, %v; want a JPEG", got, ok, err)
	}
	if got, ok, err := mtf.PictPicture(ms, mtf.Pict{Kind: "emfblip", Data: jpg()}); ok || err != nil {
		t.Errorf("emfblip: pictPicture = %+v, %v, %v; want false, nil", got, ok, err)
	}
}

func FuzzPictWMF(f *testing.F) {
	wmf := mtftest.WMF(mtftest.BMP(5, 4), true, 0x0F43)
	for i := range 10 {
		f.Add(wmf[:len(wmf)*i/10])
	}
	f.Add(wmf)
	ms, _ := store(f)
	f.Fuzz(func(t *testing.T, b []byte) {
		if _, _, err := mtf.PictPicture(ms, mtf.Pict{Kind: "wmetafile", Data: b}); err != nil {
			t.Errorf("pictPicture = %v, want nil", err)
		}
	})
}
