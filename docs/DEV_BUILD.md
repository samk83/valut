# iPhone 개발용 앱 (PVV Dev) — 설치와 매일 사용법

화면 수정(예: PR #31 촬영 깜빡임)을 **TestFlight 새 빌드 없이** 내 iPhone에서 바로 확인하는 방법입니다.

- **개발용 앱**(development build, 개발 중 확인용으로 한 번만 만드는 앱)을 iPhone에 한 번 설치합니다.
- 그 뒤로는 PC에서 명령어 하나(`npm run dev`)만 실행하면, 바뀐 화면이 iPhone에 바로 나타납니다.

## 진짜 앱과 완전히 따로입니다 (사진 안전)

| | 진짜 앱 (TestFlight) | 개발용 앱 |
|---|---|---|
| 홈 화면 이름 | Private Vision Vault | **PVV Dev** |
| 앱 ID (bundle identifier) | com.jellydock.privatevault | com.jellydock.privatevault.dev |
| 사진·PIN·설정 | 그대로 유지 | 따로 (빈 보관함에서 시작) |

- iOS는 앱 ID가 다르면 **다른 앱**으로 취급합니다. 개발용 앱은 진짜 앱 옆에 따로 설치되고, 진짜 앱을 덮어쓰거나 지우지 않습니다.
- 저장 공간과 열쇠 보관함(Keychain)도 따로라서, 개발용 앱은 진짜 앱의 사진을 **볼 수도, 바꿀 수도 없습니다**.
- 개발용 앱에는 **테스트용 사진만** 넣으세요. 개발용 앱을 지워도 진짜 앱은 아무 영향이 없습니다.
- 진짜 앱(Private Vision Vault)은 **절대 지우지 마세요.** 이 안내의 어떤 단계도 진짜 앱을 지울 필요가 없습니다.

## 개발용 앱에서 안 되는 것 / 다르게 동작하는 것

| 기능 | 개발용 앱에서 |
|---|---|
| 프리미엄 구매·복원 (인앱 구매) | **안 됨.** App Store Connect의 상품은 진짜 앱 ID에만 연결되어 있어 "사용할 수 없음"으로 나옵니다. 무료 100개 제한은 그대로 동작합니다 |
| 진짜 앱의 사진·PIN | 보이지 않음 (따로 저장) |
| 암호화 백업 | 동작하지만 **별도 폴더 "Private Vision Vault Backup (Dev)"** 에만 씁니다. 진짜 앱 백업 폴더를 골라도 그 안에 "(Dev)" 폴더 하나만 새로 만들고, 진짜 백업 파일은 읽지도 바꾸지도 지우지도 않습니다. 헷갈리지 않게 개발용 앱에서는 진짜 백업과 다른 폴더(예: 파일 앱의 On My iPhone)를 고르세요. 그래서 진짜 백업에서 복원도 안 됩니다 (의도된 동작) |
| 새 폰으로 옮기기 | 동작은 하지만 진짜 앱과 섞어서 쓰지 마세요 |
| Face ID·카메라·사진 검색 | 동작 (처음에 PVV Dev용 권한을 한 번 더 물어봅니다) |
| PC 없이 사용 | 안 됨. PC에서 `npm run dev`가 켜져 있어야 앱 화면이 열립니다 |

## 준비물

- Windows PC (C:\dev\valut 에 프로젝트가 있는 상태), PowerShell
- iPhone (TestFlight 앱이 깔린 그 폰)
- Apple 개발자 계정 (이미 가입된 계정, 추가 비용 없음)
- PC와 iPhone이 **같은 Wi-Fi**에 연결되어 있어야 합니다 (안 되면 아래 "연결이 안 될 때")

비용: EAS 무료 플랜의 월 빌드 횟수에서 iOS 빌드 1회가 차감됩니다. 무료 한도 안이면 비용은 없습니다.

---

## 1단계 — 한 번만: 최신 코드 받기

PowerShell을 열고 한 줄씩 복사해서 실행하세요.

```powershell
cd C:\dev\valut
```

```powershell
git checkout main
```

```powershell
git pull
```

```powershell
cd app
```

```powershell
npm install
```

## 2단계 — 한 번만: iPhone 등록

Expo 계정에 로그인되어 있지 않다면 먼저 (이미 로그인했다면 건너뛰기):

```powershell
npx eas-cli@latest login
```

```powershell
npx eas-cli@latest device:create
```

질문이 나오면:

1. 계정 사용 여부 → `Y`
2. Apple ID 로그인 → Apple 개발자 계정으로 로그인 (문자/기기로 오는 인증 코드 입력)
3. **How would you like to register your devices?** → **Website** 선택
4. 화면에 나온 주소(또는 QR 코드)를 **iPhone의 Safari**로 엽니다
5. **Download Profile** 누르기 → iPhone **Settings** 앱 → 맨 위 **Profile Downloaded** → **Install**

## 3단계 — 한 번만: 개발용 앱 빌드 (약 15~30분, 클라우드에서)

```powershell
npx eas-cli@latest build --platform ios --profile development
```

질문이 나오면:

- Apple 계정 로그인 → `Y` (위와 같은 계정)
- 새 앱 ID `com.jellydock.privatevault.dev` 와 개발용 프로필(provisioning profile) 만들기 → `Y`
- 인증서(Distribution Certificate)는 **이미 있는 것을 다시 사용(reuse)** 하세요
- ⚠️ **revoke(취소)** 또는 **delete(삭제)** 가 들어간 질문은 절대 고르지 마세요. 진짜 앱(TestFlight) 빌드에 쓰는 인증서가 무효가 됩니다. 그런 질문이 나오면 멈추고 알려 주세요
- **Select devices for the ad hoc build** → 2단계에서 등록한 내 iPhone 선택 (스페이스바로 체크) → Enter

> 처음 등록한 iPhone은 Apple 처리 시간 때문에 첫 빌드가 실패할 수 있습니다. 그러면 몇 시간 뒤 같은 명령어를 다시 실행하세요.

## 4단계 — 한 번만: iPhone에 설치

1. 빌드가 끝나면 PowerShell에 나온 **빌드 주소(또는 QR 코드)** 를 iPhone Safari로 엽니다
2. **Install** 누르기 → 홈 화면에 **PVV Dev** 앱이 생깁니다 (진짜 앱은 그대로 있습니다)
3. PVV Dev를 처음 열 때 **"Developer Mode Required"** 가 나오면:
   iPhone **Settings → Privacy & Security → Developer Mode → 켜기** → iPhone 재시작 → 재시작 후 **Turn On** 누르고 iPhone 암호 입력

---

## 매일 사용법

### PC에서 (명령어 하나)

```powershell
cd C:\dev\valut\app
```

```powershell
npm run dev
```

화면에 QR 코드가 나오고 "Waiting on http://192.168…" 같은 줄이 보이면 준비 완료입니다. 이 창은 확인하는 동안 **닫지 마세요.**

### iPhone에서

1. **PVV Dev** 앱을 엽니다
2. 목록에 PC 서버가 보이면 누릅니다 (안 보이면 iPhone **Camera** 앱으로 PC 화면의 QR 코드를 찍고 나오는 알림을 누르세요)
3. 처음 한 번 묻는 질문:
   - iPhone: **"PVV Dev would like to find and connect to devices on your local network"** → **Allow**
   - PC: **Windows Security(방화벽)** 창에서 Node.js → **Allow access** (Private networks 체크)

PC에서 코드가 바뀌면 iPhone 화면이 자동으로 새로 고쳐집니다. 직접 새로 고침: iPhone을 **흔들기** → 메뉴에서 **Reload**.

끝낼 때: PowerShell 창에서 `Ctrl + C`.

### 연결이 안 될 때

- PC와 iPhone이 같은 Wi-Fi인지 확인 (iPhone이 모바일 데이터만 쓰고 있으면 안 됩니다)
- 그래도 안 되면 인터넷을 거쳐 연결하는 **터널** 방식으로 실행:

```powershell
npm run dev:tunnel
```

  (Expo 터널을 사용합니다. 처음에 추가 설치를 물으면 `Y`.)

---

## PR 확인하는 법 (예: PR #31 촬영 깜빡임 수정)

PR이 아직 Merge되지 않았으면, 그 PR의 브랜치로 바꿔서 실행합니다.

```powershell
cd C:\dev\valut\app
```

```powershell
git fetch origin
```

```powershell
git checkout fix/camera-save-flicker
```

```powershell
git pull
```

```powershell
npm install
```

```powershell
npm run dev
```

iPhone PVV Dev에서 열고 → 테스트용 PIN으로 보관함 만들기(처음 한 번) → 카메라로 사진 찍기 → 저장할 때 화면이 두 번 깜빡이지 않는지 확인.

다른 PR 브랜치:

| PR | 내용 | 브랜치 |
|---|---|---|
| #31 | 촬영 저장 시 깜빡임 | `fix/camera-save-flicker` |
| #32 | 홈 무료/Pro 표시, 사진·비디오 카드 | `fix/home-plan-badge-cards` |
| #33 | 백업 폴더 안내, 복구 키 전 Face ID, 복사 버튼 | `fix/backup-folder-guide` |

확인이 끝나면 main으로 돌아가기:

```powershell
git checkout main
```

PR이 Merge된 뒤에는 브랜치를 바꿀 필요 없이 `git checkout main` → `git pull` → `npm run dev` 만 하면 됩니다.

## 개발용 앱을 다시 빌드해야 할 때

대부분의 수정(화면·문구·동작)은 `npm run dev`만으로 바로 보입니다. 아래 경우에만 3단계 빌드를 다시 하고 4단계로 다시 설치합니다.

- 새 부품(네이티브 모듈)을 추가했을 때 — 예: `package.json`에 `expo-...` 패키지가 새로 생김
- Swift(iPhone 전용 코드, `app/modules/vault-core/ios`)나 `app.json` 설정이 바뀌었을 때
- PVV Dev를 열었을 때 빨간 화면에 "native module … not found" 같은 오류가 나올 때

지금 개발용 앱에는 PR #33에 필요한 `expo-clipboard`도 미리 넣어 두었습니다.

## 참고 (개발자용)

- `app/app.config.js`: `APP_VARIANT=development`일 때만 이름 PVV Dev, bundle id `.dev`, 로컬 네트워크 http 허용(`NSAllowsLocalNetworking`). 그 외(TestFlight·App Store 빌드)는 `app.json` 그대로
- `app/eas.json` `development` 프로필: `developmentClient: true`, `distribution: internal`, `APP_VARIANT=development`
- `app/scripts/dev.js`: Windows에서도 `APP_VARIANT=development`를 넣고 `expo start --dev-client` 실행
- 백업 폴더 분리: `app/modules/vault-core/ios/Core/BackupBridge.swift` (`isDevBuild`), 테스트 `testDevBuildNeverUsesTheRealBackupFolder`
- `expo-dev-client`는 TestFlight·App Store(Release) 빌드에서는 개발 메뉴가 빠지고 동작하지 않습니다. 진짜 앱에는 dev client용 URL scheme(`exp+…`)도 넣지 않아(`addGeneratedScheme: false`), 개발 서버 QR 코드는 PVV Dev만 엽니다
- Android 개발용 빌드는 아직 계획 없음. 만든다면 Android `BackupBridge.kt`에도 같은 Dev 폴더 분리를 넣어야 합니다
