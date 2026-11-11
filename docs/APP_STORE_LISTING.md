# App Store 등록 문구 — Private Vision Vault

App Store Connect → 내 앱 → **App Store** 탭 → iOS App 1.0 화면에 복사해 넣는 문구입니다.
원칙(Owner 결정 2026-11-10): **확인된 사실만** 씁니다.

## 쓰지 않는 표현
| 쓰지 않음 | 이유 |
|---|---|
| military-grade, bank-level, unhackable, 100% secure, 해킹 불가 | 증명할 수 없는 과장. 심사 2.3 위반 위험 |
| audited, certified, 인증 | 외부 보안 감사 전 (Phase 4 미완료) |
| screenshots are impossible, 캡처 완전 차단 | iOS는 캡처를 완전히 막을 수 없음 |
| backup, sync, restore, 새 폰으로 이전 | 기능이 없음 (백업·이전 제외가 설계) |

## English (Primary Language)

**Name** (30): `Private Vision Vault`

**Subtitle** (30): `Photos encrypted on device`

**Promotional Text** (170):
> Keep private photos and videos in a vault that is encrypted on this iPhone or iPad. No account, no cloud, no internet connection used.

**Description**:
```
Private Vision Vault keeps the photos and videos you choose in an encrypted vault on this device.

WHAT IT DOES
• Encrypts every photo and video on this iPhone or iPad (AES-256-GCM).
• Protects the vault key with your PIN or pattern together with a key held in the device's Secure Enclave, so the vault only opens on this device.
• Works without an account, a server or a cloud copy. The app does not send your photos, videos or PIN anywhere.
• Take photos and videos with the in-app camera; they go straight into the vault and are not saved to your photo library.
• Move items in from your photo library. If you choose, the original is removed from the library only after the app has checked that the vault copy is identical.
• Locks the moment you leave the app and blurs its preview in the app switcher.
• Grid layout adapts to iPad and larger screens.

PLEASE READ BEFORE YOU START
• There is no recovery. Three wrong PIN or pattern attempts in a row permanently erase the vault.
• Nobody, including the developer, can reset your PIN or open your vault.
• The vault is not included in iCloud or computer backups and does not move to a new phone. Deleting the app or resetting the device erases it.
• Keep separate copies of anything you cannot afford to lose.
```

**Keywords** (100, 쉼표 구분, 공백 없이):
`vault,private,photo,video,hide,lock,secure,encrypted,offline,album,pin,locker`

**Support URL**: 소개 웹사이트 공개 후 입력 (Owner 승인 필요)
**Privacy Policy URL**: 소개 웹사이트 `privacy.html` 공개 후 입력
**Category**: Primary **Utilities**, Secondary **Photo & Video**
**Copyright**: `2026 JellyDock`

## 한국어 (추가 언어: Korean)

**부제** (30): `기기 안에서 암호화되는 사진 금고`

**프로모션 텍스트**:
> 개인 사진과 동영상을 이 iPhone·iPad 안에서 암호화해 보관하세요. 계정도, 클라우드도, 인터넷 연결도 쓰지 않습니다.

**설명**:
```
Private Vision Vault는 고른 사진과 동영상을 이 기기 안의 암호화된 금고에 보관합니다.

주요 기능
• 모든 사진·동영상을 이 iPhone·iPad 안에서 암호화합니다 (AES-256-GCM).
• 금고 열쇠는 PIN 또는 패턴과 기기의 Secure Enclave에 있는 키를 함께 써서 보호하므로, 이 기기에서만 열립니다.
• 계정·서버·클라우드 없이 동작합니다. 앱은 사진·동영상·PIN을 어디로도 보내지 않습니다.
• 앱 안 카메라로 찍은 사진·동영상은 사진 앱에 저장되지 않고 바로 금고에 들어갑니다.
• 사진 앱에서 가져올 수 있고, 원하면 금고 사본이 원본과 똑같은지 확인한 뒤에만 원본을 지웁니다.
• 앱을 벗어나는 순간 잠기고, 앱 전환 화면에서는 흐리게 가려집니다.
• iPad와 큰 화면에 맞게 사진 칸 수가 바뀝니다.

시작하기 전에 꼭 읽어 주세요
• 복구 기능은 없습니다. PIN·패턴을 연속 3번 틀리면 금고가 영구 삭제됩니다.
• 개발자를 포함해 누구도 PIN을 재설정하거나 금고를 열 수 없습니다.
• 금고는 iCloud·컴퓨터 백업에 포함되지 않고 새 핸드폰으로 옮겨지지 않습니다. 앱을 지우거나 기기를 초기화하면 함께 지워집니다.
• 잃으면 안 되는 자료는 따로 사본을 보관하세요.
```

**키워드**: `금고,사진숨기기,비밀앨범,잠금,암호화,동영상,오프라인,보안,사진잠금,개인앨범`

## App Review 메모 (Notes)
```
Private Vision Vault is a fully offline vault for photos and videos. No account and no network are used.
On first launch, tick the consent box (3 wrong attempts permanently erase the vault; Terms of Use), then create a PIN of 4+ digits (avoid simple ones like 1234) or a pattern.
IMPORTANT: 3 wrong PIN entries permanently erase the vault by design (security feature).
To test: create a PIN, tap "Import from Photos" to add a photo, or use the camera button; open an item to view it.
Encryption: AES-256-GCM via Apple CryptoKit, used only to protect the user's own data on the device.
```

## 정식 제출 전 확인 (Owner 결정)
- 앱 상단 "TEST BUILD" 경고 문구 제거 여부
- 외부 보안 감사 전 출시 여부
- Mac 판매 끄기: Pricing and Availability → **iPhone and iPad Apps on Apple Silicon Macs** 체크 해제 (Mac에서는 Secure Enclave 동작을 확인하지 않음)

## 1.1 변경 (1.1 버전 제출 때 바꿔 넣기)
1.0 문구는 그대로 두고, 1.1을 제출할 때 아래만 바꿉니다.

**What's New in This Version**:
```
• Move to a new phone: send your vault directly from your old phone to your new one over your own Wi-Fi. It stays encrypted the whole way and is never uploaded anywhere. Works between iPhone and Android.
• Free plan: up to 100 photos and videos with every security feature.
• Lifetime Premium: unlimited photos and videos for a single payment. No subscription, no ads.
```

**Description**에서 바꿀 줄:
- `• Works without an account, a server or a cloud copy.` 다음 줄에 추가: `• Move to a new phone directly over your own Wi-Fi; nothing goes through the internet.`
- 맨 끝에 추가: `Free: up to 100 photos and videos. Lifetime Premium (one-time purchase): unlimited.`

**쓰지 않는 표현** 표의 "새 폰으로 이전" 줄은 1.1부터 삭제 (기능이 생김). "backup, sync, cloud restore"는 계속 쓰지 않음.

**App Review 메모**에 추가:
```
In-App Purchase: one non-consumable product "Lifetime Premium" (com.jellydock.privatevault.premium). The free plan holds 100 photos/videos; at the limit the app shows the purchase screen. "Restore purchases" is in Settings and on the purchase screen.
Move to a new phone (Settings > Move to a new phone): two devices on the same Wi-Fi; the new device shows a QR code, the old device scans it. The connection is direct on the local network (the app asks for Local Network access), encrypted with a one-time key from the QR code. No server is involved.
```
