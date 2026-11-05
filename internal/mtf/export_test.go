package mtf

// Read lets the tests in package mtf_test call read. They need mtftest, which
// imports mtf, so they cannot be in package mtf.
var Read = read
