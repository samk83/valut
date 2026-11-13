// Dynamic config on top of app.json (static values stay there).
//
// APP_VARIANT=development builds the "development build": a separate app, "PVV Dev", that
// installs next to the real Private Vision Vault from TestFlight / the App Store and never
// replaces it. It has its own bundle identifier, so iOS gives it its own storage and its
// own Keychain: it cannot see or touch the photos in the real app (owner rule: photos must
// never be lost). It loads its JavaScript live from the PC (`npm run dev`).
//
// Without APP_VARIANT (TestFlight / App Store builds) the config is exactly app.json.
const fs = require('fs');
const path = require('path');

const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = ({ config, projectRoot }) => {
  if (!IS_DEV) return config;
  const name = 'PVV Dev';
  return {
    ...config,
    name,
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.jellydock.privatevault.dev',
      infoPlist: {
        ...config.ios.infoPlist,
        CFBundleDisplayName: name,
        CFBundleName: name,
        // The dev app loads its code over plain http from the PC on the same Wi-Fi.
        NSAppTransportSecurity: {
          ...config.ios.infoPlist.NSAppTransportSecurity,
          NSAllowsLocalNetworking: true,
        },
      },
    },
    android: {
      ...config.android,
      package: 'com.jellydock.privatevault.dev',
    },
    // Each language file sets the home-screen name to "Private Vision Vault"; the dev app
    // keeps the translated permission texts but always shows "PVV Dev" under its icon.
    locales: Object.fromEntries(
      Object.entries(config.locales ?? {}).map(([lang, file]) => {
        const locale = typeof file === 'string' ? JSON.parse(fs.readFileSync(path.join(projectRoot, file), 'utf8')) : file;
        return [lang, { ...locale, ios: { ...locale.ios, CFBundleDisplayName: name } }];
      }),
    ),
  };
};
