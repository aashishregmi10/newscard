/**
 * babel-preset-expo already wires up expo-router and, in SDK 54+, the
 * Reanimated/Worklets transform — so this file exists mainly to make that
 * explicit and to give us somewhere to hang project-specific plugins.
 *
 * If Reanimated animations ever silently do nothing, this is the first place to
 * look: its plugin must run LAST.
 */
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
