export const APP_STORE_URL = 'https://apps.apple.com/app/id6805606134';
export type DevicePlatform = 'iOS' | 'macOS' | 'Windows' | 'Linux' | 'browser';

/** Browsers conceal Mac architecture; never silently choose an Intel/ARM installer. */
export function devicePlatform(
  userAgent = navigator.userAgent,
  platform = navigator.platform,
  maxTouchPoints = navigator.maxTouchPoints,
): DevicePlatform {
  if (/iphone|ipad|ipod/i.test(userAgent) || (/mac/i.test(platform) && maxTouchPoints > 1))
    return 'iOS';
  // Android and ChromeOS run Polaris in the browser, not the desktop Linux installer.
  if (/android|cros/i.test(userAgent)) return 'browser';
  if (/win/i.test(`${platform} ${userAgent}`)) return 'Windows';
  if (/mac/i.test(`${platform} ${userAgent}`)) return 'macOS';
  if (/linux|x11/i.test(`${platform} ${userAgent}`)) return 'Linux';
  return 'browser';
}
