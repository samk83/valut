# PrivateVault — Android 테스트 앱

Expo(React Native) 화면 + `../core` Kotlin 보안 코어. 설치·테스트 방법은 [docs/ANDROID_TEST_APP.md](../docs/ANDROID_TEST_APP.md).

- `modules/vault-core/`: 코어를 그대로 컴파일하는 Expo 네이티브 모듈과 Android Keystore 키
- `src/screens/`: 화면 (Obsidian & Brass, docs/DESIGN.md)
- `android/`는 `npx expo prebuild`로 만들어지며 저장소에 넣지 않습니다.
- Expo Go에서는 동작하지 않습니다 (자체 네이티브 코드 포함).

```
npm install
npx tsc --noEmit
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```
