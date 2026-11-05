package mtftest

import "testing"

func TestRTF(t *testing.T) {
	got := RTF("a{b}\\c Привіт ✓\n😀", []byte{0x01, 0xab}, []byte{0xff})
	want := `{\rtf1\ansi\ansicpg1251{\fonttbl{\f0\fnil\fcharset204 Times New Roman;}}\f0 ` +
		`a\{b\}\\c \'cf\'f0\'e8\'e2\'b3\'f2 \u10003?\par \u-10179?\u-8704?` +
		`{\pict\wmetafile8\picw1\pich1 01ab}{\pict\wmetafile8\picw1\pich1 ff}}`
	if got != want {
		t.Errorf("RTF =\n%s\nwant\n%s", got, want)
	}
}
