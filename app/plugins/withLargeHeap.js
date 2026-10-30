// Argon2id needs a 64 MiB working buffer in the Java heap during each PIN check.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withLargeHeap(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) app.$['android:largeHeap'] = 'true';
    return cfg;
  });
};
