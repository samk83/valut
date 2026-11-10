// iPhone: portrait only (the approved design). iPad and unfolded iPhone: every orientation,
// which Apple requires for iPad multitasking (Split View, Stage Manager).
const { withInfoPlist } = require('expo/config-plugins');

const PORTRAIT = ['UIInterfaceOrientationPortrait'];
const ALL = [
  'UIInterfaceOrientationPortrait',
  'UIInterfaceOrientationPortraitUpsideDown',
  'UIInterfaceOrientationLandscapeLeft',
  'UIInterfaceOrientationLandscapeRight',
];

module.exports = function withIosOrientations(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UISupportedInterfaceOrientations = PORTRAIT;
    cfg.modResults['UISupportedInterfaceOrientations~ipad'] = ALL;
    return cfg;
  });
};
