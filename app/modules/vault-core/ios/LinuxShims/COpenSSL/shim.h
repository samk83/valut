// Linux-only: lets the core's unit tests run without CryptoKit (never part of the iOS app).
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>
#include <openssl/sha.h>
