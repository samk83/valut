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
| `assets/video/how-to.mp4` | 사용법 영상 (50초, 1920×1080, 소리 없음, 약 4 MB) |
| `assets/video/poster.jpg` | 영상 첫 화면 + 링크 공유 미리보기 이미지 |
| `assets/shots/*.webp` | 실제 앱 화면 (iPhone 6.9형 App Store 스크린샷 축소본) |
| `assets/fonts/` | 글꼴 (영문만, SIL OFL) |
| `tools/prepare_shots.py` | 스크린샷 준비 (확정 안 된 문구 가리기) |
| `tools/make_video.js` | 영상 다시 만들기 도구 |

## TestFlight 링크 넣기
1. App Store Connect → 앱 → **TestFlight** → **External Testing** 그룹 → **Public Link** 켜기 → 링크 복사 (`https://testflight.apple.com/join/...`)
2. `config.js`를 메모장으로 열어 `testflightUrl: ""`의 따옴표 안에 붙여넣고 저장
3. 다시 올리면 "Coming soon" 버튼이 "Join on TestFlight" 링크로 바뀝니다

`https://testflight.apple.com/join/` 으로 시작하는 링크만 받습니다 (다른 주소는 무시).

## 내 컴퓨터에서 보기 (Windows)
```
cd website\beta\myvisionvault
python -m http.server 8000
```
브라우저에서 http://localhost:8000 을 엽니다.

## 영상 다시 만들기
앱은 녹화가 감지되면 화면을 가리므로, 영상은 실제 앱 스크린샷으로 만듭니다. 화면이나 자막을 바꾸면 저장소 맨 위 폴더에서:
```
python website/beta/myvisionvault/tools/prepare_shots.py <App Store 스크린샷 iphone-6.9 폴더> shots-prepared
node website/beta/myvisionvault/tools/make_video.js shots-prepared
```
`prepare_shots.py`는 아직 확정되지 않았거나 과장될 수 있는 앱 문구 몇 줄("3번 틀리면 파기", "Screenshots blocked", 옛 "No network access")을 지우고 다시 씁니다. 자세한 내용은 파일 맨 위 설명 참고.
필요한 것: Node, Playwright(Chromium), ffmpeg. 자막 문구는 `make_video.js`의 `scenes` 목록에 있습니다.

## 올리기 전에 확인
- 공유 미리보기(`og:url`, `og:image`)는 `https://jellydock.com/beta/myvisionvault/` 주소를 가정합니다. 주소가 바뀌면 `index.html` 위쪽 두 줄을 고칩니다.
- 공개 배포는 Owner 승인 후 진행합니다 (L3).
- "틀린 횟수 제한" 문구는 최종 규칙이 정해지지 않아 일부러 단정하지 않았습니다. 규칙이 정해지면 `index.html`의 *Wrong attempts* 줄, *Don’t experiment with wrong PINs* 카드, 그리고 `tools/prepare_shots.py`(화면 02·08 문구)를 고친 뒤 영상을 다시 만듭니다.
