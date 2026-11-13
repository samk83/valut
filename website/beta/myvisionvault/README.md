# Private Vision Vault 베타 홈페이지

`jellydock.com/beta/myvisionvault/` 주소에 올리기 위한 베타 테스터용 페이지입니다 (영어, Owner 결정 2026-11-12).
이 폴더 하나만 그대로 올리면 동작합니다 (다른 폴더의 파일을 쓰지 않음, 외부 요청·추적 없음).

## 구성
| 파일 | 내용 |
|---|---|
| `index.html` | 페이지: 소개 · 사용법 영상 · 빠른 시작 4단계 · 적용 기술 · 사용 원칙과 테스트 전 주의사항 · 베타 참여 방법 |
| `config.js` | **TestFlight 링크 넣는 곳** (아래 참고) |
| `beta.js` | config.js에 링크가 있으면 버튼 2개를 켜는 스크립트 |
| `base.css` | 기존 소개 웹사이트(`website/styles.css`) 디자인 복사본 |
| `beta.css` | 베타 페이지 전용 스타일 |
| `assets/video/how-to.mp4` | 사용법 영상 (1분 42초, 1920×1080, 내레이션 + 배경 음악, 약 11 MB) |
| `assets/video/poster.jpg` | 영상 첫 화면 + 링크 공유 미리보기 이미지 |
| `assets/shots/*.webp` | 실제 앱 화면 11장 (main의 최신 앱: 백업·전체화면 갤러리·사진 검색 포함, iPhone 6.9형 크기의 절반). 사진 출처는 `assets/shots/CREDITS.md` |
| `assets/fonts/` | 글꼴 (영문만, SIL OFL) |
| `tools/capture_shots.js` | 앱 웹 미리보기에서 화면 11장 자동 촬영 |
| `tools/screenshot_patch.py` | 촬영 때만 쓰는 임시 앱 수정 (커밋 금지) |
| `tools/gen_text_samples.py` | 검색 장면용 예시 사진 (영수증·메모·예약 화면, 모두 지어낸 내용) |
| `tools/make_video.js` | 영상 만들기 (장면·자막 목록 포함) |
| `tools/make_music.py` | 배경 음악 만들기 (코드로 작곡, 저작권 걱정 없음) |

## TestFlight 링크 넣기
1. App Store Connect → 앱 → **TestFlight** → **External Testing** 그룹 → **Public Link** 켜기 → 링크 복사 (`https://testflight.apple.com/join/...`)
2. `config.js`를 메모장으로 열어 `testflightUrl: ""`의 따옴표 안에 붙여넣고 저장
3. 다시 올리면 "Coming soon" 버튼이 "Join on TestFlight" 링크로 바뀝니다
4. Apple 베타 심사가 끝나기 전에는 `reviewPending: true`로 두면 "심사 중, 승인 후 링크가 동작" 안내가 함께 보입니다. 승인되면 `false`로 바꿉니다.

현재 링크(2026-11-12): `https://testflight.apple.com/join/pFr2dxch` (외부 그룹 "public beta", 빌드 3 베타 심사 대기)

`https://testflight.apple.com/join/` 으로 시작하는 링크만 받습니다 (다른 주소는 무시).

## 내 컴퓨터에서 보기 (Windows)
```
cd website\beta\myvisionvault
python -m http.server 8000
```
브라우저에서 http://localhost:8000 을 엽니다.

## 영상 다시 만들기
앱은 녹화가 감지되면 화면을 가리므로, 영상은 앱 화면을 한 장씩 찍어 만듭니다. 필요한 것: Node, Playwright, ffmpeg, Python(numpy, Pillow).

1. **화면 촬영** (main 브랜치의 `app` 폴더에서, 끝나면 반드시 되돌리기):
   ```
   npx expo install react-dom react-native-web @expo/metro-runtime
   python <이 폴더>/tools/screenshot_patch.py
   npx expo export -p web --output-dir <작업폴더>/web
   git checkout -- .
   ```
   `<작업폴더>/web/posters/0.jpg ~ 3.jpg`(동영상 썸네일)를 넣고 `python -m http.server 8765 -d <작업폴더>/web`로 띄운 뒤,
   `app/src/i18n/en.ts`를 `<작업폴더>/en.json`으로 저장하고(`node --experimental-strip-types`로 import 후 JSON.stringify),
   `python tools/gen_text_samples.py <작업폴더> <Inter 글꼴 폴더>`로 예시 사진과 `notes.json`을 만든 다음:
   ```
   node tools/capture_shots.js <작업폴더> <화면폴더> <사진·동영상 파일들...>
   ```
   설정 화면의 "Screenshots blocked"(iPhone에서 완전히 막을 수 없어 쓰지 않는 표현)와 웹 미리보기 전용 안내는 촬영 때 가립니다.
2. **페이지용 이미지**: `<화면폴더>/*.png`를 660×1434 WebP로 줄여 `assets/shots/`에 넣습니다.
3. **음악**: `python tools/make_music.py music.wav 125`
4. **영상**: `node tools/make_video.js <화면폴더> <내레이션 폴더> music.wav`
   내레이션 폴더에는 장면별 MP3(`00.mp3`, `01.mp3`, … `outro.mp3`)를 넣습니다. 파일이 없는 장면은 자막만 나옵니다.
   현재 영상은 이전 영상의 내레이션 11줄을 그대로 다시 썼고(문구가 지금 앱과도 맞음), 새 장면(백업 `bk`, 갤러리 `gl`, 검색 `sr`)과 설정·잠금 화면은 자막만 있습니다.
   새 줄을 녹음하려면 같은 목소리(ElevenLabs "Belle B")로 `bk.mp3`, `gl.mp3`, `sr.mp3`를 만들어 넣고 다시 실행하면 장면 길이가 자동으로 맞춰집니다.

## 올리기 전에 확인
- 공유 미리보기(`og:url`, `og:image`)는 `https://jellydock.com/beta/myvisionvault/` 주소를 가정합니다. 주소가 바뀌면 `index.html` 위쪽 두 줄을 고칩니다.
- 공개 배포는 Owner 승인 후 진행합니다 (L3).
- 페이지 문구는 Owner 결정(2026-11-12)을 반영했습니다: 틀려도 파기 없음(3번 후 1·5·15분, 이후 1시간 대기), 가져오기는 복사만(원본 삭제 없음).
- 영상과 스크린샷은 2026-11-13 main의 앱(대기 잠금·복사 전용·암호화 백업·전체화면 갤러리·사진 검색) 화면입니다. 앱 화면이 바뀌면 위 순서로 다시 만듭니다.
