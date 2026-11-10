// Terms of Use shown in the app before a vault is created (and from Settings).
// Draft by the development team; to be checked by a lawyer before public release.
// Kept in sync with docs/TERMS.md.

export const TERMS_VERSION = '2026-11-10';

export const TERMS_TITLE = 'Terms of Use';

export const TERMS: { heading: string; body: string }[] = [
  {
    heading: '1. What the app does',
    body:
      'Private Vision Vault ("the app") stores photos and videos you choose in encrypted form on this device. It has no account, no server and no cloud copy. These terms are between you and JellyDock, the developer. Apple\'s Standard Licensed Application End User License Agreement also applies.',
  },
  {
    heading: '2. No recovery, by design',
    body:
      'Only your PIN or pattern can open the vault. Three wrong attempts in a row permanently destroy the keys, and everything in the vault is lost. Nobody, including JellyDock, can reset your PIN, unlock the vault or recover its contents. Deleting the app, resetting or losing the device has the same result. The vault is never included in iCloud or computer backups or in the phone maker’s transfer to a new phone. The only way to move it is Move to a new phone in the app’s settings, which sends it directly to your other phone over your own Wi-Fi while you hold both phones.',
  },
  {
    heading: '3. Your responsibility',
    body:
      'You are responsible for remembering your PIN or pattern and for keeping other copies of anything you cannot afford to lose. If you choose to delete originals from your photo library after import, those originals may also remain in Recently Deleted or in other backups until you remove them.',
  },
  {
    heading: '4. No warranty',
    body:
      'The app is provided "as is" and "as available", without warranties of any kind, express or implied, including fitness for a particular purpose and uninterrupted or error-free operation. No security measure is perfect, and JellyDock does not guarantee that the app will protect your content against every attack.',
  },
  {
    heading: '5. Limitation of liability',
    body:
      'To the fullest extent permitted by law, JellyDock is not liable for any loss of data or content, or for any indirect, incidental, special or consequential damages, arising from the use of or inability to use the app, including loss caused by forgotten PINs, wrong attempts, device loss, deletion of the app or deletion of originals. Where liability cannot be excluded, it is limited to the amount you paid for the app. Nothing in these terms limits rights you have under laws that cannot be changed by contract, or liability for intent or gross negligence where the law does not allow that to be limited.',
  },
  {
    heading: '6. Changes and contact',
    body:
      'JellyDock may update these terms; the app will ask you to accept material changes. Questions: see the Support link on the App Store page.',
  },
];
