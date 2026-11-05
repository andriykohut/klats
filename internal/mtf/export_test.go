package mtf

// Read, StorePicture, PictPicture and Pict let the tests in package mtf_test
// reach read, storePicture, pictPicture and pict. They need mtftest, which
// imports mtf, so they cannot be in package mtf.
var (
	Read         = read
	StorePicture = storePicture
	PictPicture  = pictPicture
)

type Pict = pict
