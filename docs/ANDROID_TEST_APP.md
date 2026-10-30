# PrivateVault 안드로이드 테스트 앱 설치 안내

> ⚠️ **테스트 전용입니다.** 진짜 사진·영상은 넣지 마세요.
> PIN을 **3번 틀리면 금고 안의 모든 것이 영구 삭제**됩니다. 되살릴 방법이 없습니다.
> PIN을 잊어버려도 복구할 수 없습니다.

## 1. 휴대폰에 설치하기 (APK = 안드로이드 설치 파일)
1. 휴대폰에서 `PrivateVault-test.apk` 파일을 받습니다. (카카오톡 나에게 보내기, Google Drive, USB 케이블 등)
2. 휴대폰 **Files(내 파일)** 앱에서 APK를 누릅니다.
3. "출처를 알 수 없는 앱" 경고가 나오면 **Settings(설정)** → 지금 사용 중인 앱(예: Files, Chrome)에 대해 **Allow from this source(이 출처 허용)** 를 켭니다.
4. **Install(설치)** 를 누릅니다.
5. "Play 프로텍트" 경고가 나오면 **More details(세부정보)** → **Install anyway(무시하고 설치)** 를 누릅니다. 직접 만든 테스트 앱이라 Google에 등록되지 않아서 나오는 경고입니다.
6. 앱 목록에서 **PrivateVault Test** (황동색 다이얼 아이콘)를 엽니다.

- 지원: Android 8.0 이상, 64비트(arm64) 휴대폰 (2017년 이후 대부분 기종)
- Expo Go 앱으로는 열 수 없습니다. 보안칩을 쓰는 자체 코드가 들어 있어서 APK로 설치해야 합니다.

### PC에서 USB로 설치 (선택, 개발자 모드 필요)
```
adb install PrivateVault-test.apk
```

## 2. 확인해 볼 것
| # | 해볼 것 | 기대 결과 |
|---|---|---|
| 1 | 첫 화면 → Create PIN, 4자리 이상 두 번 입력, 동의 체크 | 금고 홈 화면 |
| 2 | `1234`, `1111` 같은 PIN 입력 | 거부 메시지 |
| 3 | Camera → 사진 촬영, Video로 바꿔 녹화 후 정지 | 홈에 썸네일 추가, 휴대폰 갤러리에는 **없음** |
| 4 | Import → 갤러리에서 사진 선택 | 암호화 후 "원본 삭제/유지" 선택 |
| 5 | 사진·영상 눌러 보기, Delete | 열람 / 영구 삭제 |
| 6 | 홈 버튼으로 나갔다가 다시 들어오기 | 바로 PIN 화면 (자동 잠금) |
| 7 | 앱 안에서 스크린샷 | 차단됨 |
| 8 | 설정(⚙) | 보안칩 종류(StrongBox 또는 TEE) 표시 |
| 9 | PIN 일부러 3번 틀리기 | 2번째 후 "Last chance", 3번째에 금고 파기 |
| 10 | Settings → Reset vault → DESTROY 입력 | 금고 파기 |

PIN 확인은 보안을 위해 일부러 1~3초 걸립니다.

## 3. 알려진 한계 (테스트 빌드)
- 동영상은 재생하는 동안만 앱 전용 폴더에 임시로 풀었다가 닫거나 잠그면 지웁니다. (정식판: 임시 파일 없이 재생)
- 패턴 잠금은 아직 없습니다 (PIN만).
- 화면 문구는 영어입니다 (디자인 시안 기준).
- iPhone용은 아직 없습니다.
- 서명은 개발용(debug) 키라서 Play 스토어에 올릴 수 없습니다.

## 4. 직접 빌드하기 (개발자용)
Android SDK, JDK 17 이상, Node.js 20 이상 필요.
```
cd app
npm install
npx expo prebuild --platform android
cd android
gradlew.bat assembleRelease
```
결과물: `app/android/app/build/outputs/apk/release/app-release.apk`
