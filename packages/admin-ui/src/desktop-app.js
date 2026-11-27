/**
 * The signed, notarized PTech Admin desktop app. The web admin offers it; the
 * desktop host never does (it is already running it). Served from the R2
 * bucket `ptech-admin-downloads` (dsh-admin-app FORK.md, "Distribution").
 */
export const DESKTOP_APP = Object.freeze({
  url: 'https://downloads.ptechsolutions.net/ptech-admin-mac-arm64.dmg',
  label: 'PTech Admin for Mac',
  requirement: 'Apple Silicon Macs (M1 or newer)',
});
