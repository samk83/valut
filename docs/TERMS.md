# 이용약관 (Terms of Use) — Private Vision Vault

앱 첫 설정 화면의 동의 체크박스와 설정 화면의 **Terms of Use** 링크에서 같은 내용을 보여줍니다. 영어 원문은 `app/src/i18n/en.ts`(`terms.*`)이며 이 문서와 함께 고쳐야 합니다. 다른 언어 번역은 `app/src/i18n/<언어>.ts`에 있고, 번역과 영어판이 다르면 영어판이 우선합니다.

> 주의: 개발팀이 작성한 초안입니다. 정식 출시 전에 변호사 검토를 권장합니다. 특히 한국 「약관의 규제에 관한 법률」·소비자 관련 법은 고의·중과실 책임 면제를 무효로 보므로, 6조는 "법이 허용하는 범위에서"로 제한해 두었습니다.

## 핵심 요약 (한국어)
- 1조: 앱은 기기 안에서 암호화 보관. 계정·서버 없음, JellyDock은 사용자 파일을 받지 않음. 사진 검색(글자 읽기·내용 인식)은 기기 안에서만 하고 결과는 틀릴 수 있음. Apple 표준 EULA도 함께 적용 (2026-11-13 변경)
- 2조: 기본은 두 겹 잠금(휴대폰 자체 잠금 → PIN·패턴, 1단계는 설정에서 끌 수 있음), 휴대폰 잠금만으로는 안 열림 (2026-11-13 추가). 잘못 입력해도 아무것도 지우지 않음. 3회 이후에는 시도마다 대기 시간이 길어짐(최대 1시간). PIN 재설정·복구는 누구도 불가. 폰 백업·제조사 이전에는 금고가 포함되지 않음. 대신 사용자가 고른 폴더(iCloud Drive 등)에 암호화 백업을 둘 수 있고, 복구 키로만 열림. 앱 삭제·초기화·분실 시 복구 키로 복원 가능. 기기와 복구 키를 모두 잃거나 백업을 켜지 않았으면 내용은 사라짐. 금고는 사용자가 설정의 '보관함 전체 파기'로만 지움 (2026-11-12.2 변경)
- 3조: PIN 기억, 복구 키 보관, 백업 폴더 유지·용량, 중요한 자료의 별도 사본은 사용자 책임. 백업 파일과 복구 키를 둘 다 가진 사람은 백업을 열 수 있음. 가져오기는 복사만 하고 원본은 사용자가 직접 지움 (2026-11-12.2 변경)
- 4조 (신설 2026-11-13): 무료 플랜은 사진·동영상 합계 100개, 모든 보안 기능 포함. Lifetime Premium은 한 번 결제(구독·광고 없음). 가격·결제·환불·가족 공유는 App Store·Google Play 약관을 따르고 JellyDock은 결제 정보를 받지 않음. 새 폰에서는 같은 계정으로 '구입 항목 복원'. 한도 도달·환불 시에도 기존 항목은 열람·삭제 가능, 추가만 막힘. 새 폰으로 옮기기는 무료이고 한도로 막히지 않음
- 5조: 있는 그대로 제공, 완벽한 보안을 보장하지 않음
- 6조: 법이 허용하는 최대 범위에서 자료 손실(복구 키 분실·백업 폴더 문제 포함)·간접 손해 책임 제한, 책임이 인정되면 앱 결제 금액 한도 (Lifetime Premium 결제액 포함, 2026-11-13 변경)
- 7조: 약관 변경 시 앱에서 다시 동의

## App Store Connect
- **License Agreement**는 Apple 표준 EULA를 그대로 두고, 이 약관은 앱 안에서 추가로 동의받습니다 (맞춤 EULA를 넣으면 Apple 최소 조항을 직접 포함해야 해서 더 복잡해집니다).

## English text (version 2026-11-13)

### 1. What the app does

Private Vision Vault ("the app") stores photos and videos you choose in encrypted form on this device. It has no account and no server, and JellyDock never receives your files. These terms are between you and JellyDock, the developer. Apple's Standard Licensed Application End User License Agreement also applies. Photo search reads the text and recognizes what is shown in your photos on this device only. Nothing is sent anywhere, and search results are produced automatically and may be incomplete or wrong.

### 2. No PIN reset; backup only with your key

By default the app first asks for your phone's own lock (Face ID, Touch ID, fingerprint or device passcode) and then your PIN or pattern; you can turn the first step off in Settings. The phone lock alone never opens the vault. Only your PIN or pattern can open the vault. Wrong attempts never erase anything; after three wrong attempts in a row each further attempt has to wait, longer every time (up to one hour). Nobody, including JellyDock, can reset your PIN, unlock the vault or recover its contents. The vault is never included in iCloud or computer backups or in the phone maker’s transfer to a new phone. Instead, the app can keep an encrypted backup in a folder you choose (for example iCloud Drive or a folder on your phone). The backup can only be opened with your recovery key, which only you have. If you delete the app, reset or lose the device, you can restore the backup with the recovery key. If you lose both the device and the recovery key, or you never set up the backup, the contents are lost. You can also use Move to a new phone in the app’s settings, which sends the vault directly to your other phone over your own Wi-Fi while you hold both phones. Only you can erase the vault, with Destroy entire vault in Settings.

### 3. Your responsibility

You are responsible for remembering your PIN or pattern, keeping your recovery key safe, making sure the backup folder you choose stays available and has enough space, and keeping other copies of anything you cannot afford to lose. Anyone who has both your backup files and your recovery key can open the backup. Importing only copies photos and videos into the vault: the originals stay in your photo library until you delete them yourself.

### 4. Free plan and Lifetime Premium

The free plan holds up to 100 photos and videos in total, with every security feature. Lifetime Premium removes that limit for a single in-app purchase; it is not a subscription and has no ads. Prices, payment, refunds and, on Apple devices, Family Sharing are handled by the App Store or Google Play under their own terms, and JellyDock does not receive your payment details. On a new phone, tap Restore purchases with the same Apple ID or Google account. If the free limit is reached, or Premium ends because of a refund, everything already in the vault stays viewable and deletable; only adding new items is blocked. Moving your vault to a new phone is free and is never blocked by the limit.

### 5. No warranty

The app is provided "as is" and "as available", without warranties of any kind, express or implied, including fitness for a particular purpose and uninterrupted or error-free operation. No security measure is perfect, and JellyDock does not guarantee that the app will protect your content against every attack.

### 6. Limitation of liability

To the fullest extent permitted by law, JellyDock is not liable for any loss of data or content, or for any indirect, incidental, special or consequential damages, arising from the use of or inability to use the app, including loss caused by forgotten PINs, lost recovery keys, backup folders that were removed, full or unavailable, device loss, deletion of the app or originals you delete yourself. Where liability cannot be excluded, it is limited to the amount you paid for the app. Nothing in these terms limits rights you have under laws that cannot be changed by contract, or liability for intent or gross negligence where the law does not allow that to be limited. Amounts you paid for Lifetime Premium count as amounts paid for the app.

### 7. Changes and contact

JellyDock may update these terms; the app will ask you to accept material changes. Questions: see the Support link on the App Store page.
