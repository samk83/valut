# iPhone Expo Go 미리보기 안내 (미리보기 전용)

> ⚠️ 이 버전은 **화면과 흐름만 보는 미리보기**입니다. 암호화가 없고, 가짜 데이터만 쓰며, 앱을 닫으면 내용이 사라집니다. 진짜 사진을 넣지 마세요.

## 준비물
- iPhone에 **Expo Go** 앱 (App Store에서 무료 설치, 최신 버전으로 업데이트)

## 방법 1 — QR 코드 (다른 화면에 QR을 띄울 수 있을 때)
1. 컴퓨터나 다른 기기에서 `iphone-expo-go-QR.png`를 엽니다.
2. iPhone 기본 **Camera** 앱으로 QR을 비춥니다.
3. 위에 뜨는 **Open in Expo Go**를 누릅니다.

## 방법 2 — 주소 직접 입력 (iPhone 하나만 있을 때)
1. 아래 주소를 길게 눌러 복사합니다.
```
exp://u.expo.dev/02a59862-6e9e-457f-8635-b17377c24f4e?channel-name=preview
```
2. Safari 주소창에 붙여넣고 이동 → **Open in Expo Go**(“Expo Go에서 열기”)를 누릅니다.
   - 안 되면 Expo Go 앱 첫 화면의 **Enter URL manually**에 붙여넣고 **Connect**를 누릅니다.

## 안 열릴 때
- Expo Go를 App Store에서 최신 버전으로 업데이트한 뒤 다시 시도
- “Project is incompatible with this version of Expo Go” 같은 문구가 보이면 화면을 캡처해서 보내주세요.

## 참고 (개발용)
- Expo 프로젝트: https://expo.dev/accounts/chihunkim/projects/privatevault-test
- 브랜치 `feature/ios-preview`, EAS Update 채널·브랜치 `preview` (SDK 58). 새로 게시하면 같은 주소로 최신 버전이 열립니다
