# Private Vision Vault 베타 홈페이지

`jellydock.com/beta/myvisionvault/` 주소에 올리기 위한 베타 테스터용 페이지입니다 (영어, Owner 결정 2026-11-12).
이 폴더 하나만 그대로 올리면 동작합니다 (다른 폴더의 파일을 쓰지 않음, 외부 요청·추적 없음).

## 구성
| 파일 | 내용 |
|---|---|
| `index.html` | 페이지: 소개(사진 검색·암호화 백업 포함) · 사용법 영상 · 빠른 시작 4단계 · 적용 기술 · 사용 원칙과 테스트 전 주의사항 · 베타 참여 방법 |
| `config.js` | **TestFlight 링크 넣는 곳** (아래 참고) |
| `beta.js` | config.js에 링크가 있으면 버튼 2개를 켜는 스크립트 |
| `base.css` | 기존 소개 웹사이트(`website/styles.css`) 디자인 복사본 |
| `beta.css` | 베타 페이지 전용 스타일 |
| `assets/video/how-to.mp4` | 사용법 영상 (약 1분 45초, 1920×1080, 내레이션 + 오리지널 배경음악, 약 11 MB) |
| `assets/video/poster.jpg` | 영상 첫 화면 + 링크 공유 미리보기 이미지 |
| `assets/shots/*.webp` | 최신 앱 화면 11장 (iPhone 6.9형 크기로 찍어 660px로 축소). 사진 출처는 `assets/shots/CREDITS.md` |
| `assets/fonts/` | 글꼴 (영문만, SIL OFL) |
| `tools/capture_app.js` | 앱 웹 빌드(데모 금고)에서 화면 11장 찍기 |
| `tools/make_receipt.py`, `tools/sample_notes.json` | 검색 시연용 가짜 영수증 사진과 사진별 검색 노트 |
| `tools/make_music.py` | 배경음악 만들기 (직접 만든 곡, 외부 음원 없음) |
| `tools/make_video.js` | 영상 다시 만들기 도구 (음악은 make_music.py를 자동 실행) |

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
앱은 녹화가 감지되면 화면을 가리므로, 영상은 앱 화면을 찍은 이미지로 만듭니다.
1. 앱 화면 찍기: 앱을 임시 복사본에서 웹으로 빌드(`npx expo export -p web`)하고 `localhost:8765`로 띄운 뒤 `node tools/capture_app.js <작업 폴더>`. 임시 복사본에만 넣는 스크린샷용 수정과 작업 폴더 구성은 `capture_app.js` 맨 위 설명에 있습니다 (커밋하지 않음).
2. 영상 만들기 (저장소 맨 위 폴더에서):
```
node website/beta/myvisionvault/tools/make_video.js <작업 폴더>/raw <내레이션 MP3 폴더>
```
내레이션 폴더를 빼면 음악만 들어갑니다. 자막 문구는 `make_video.js`의 `scenes` 목록에 있습니다. 필요한 것: Node, Playwright(Chromium), ffmpeg, Python 3 + numpy.
- 내레이션: ElevenLabs로 만든 9줄(00, 01, 02, 03, ta, tb, tc, outro). 갤러리·검색·백업·설정·잠금 장면은 무료 사용량이 막혀 자막 + 음악만 있습니다. 유료 플랜이 생기면 해당 장면에 `vo` 키를 붙이고 MP3를 넣어 다시 만들면 됩니다.

## 올리기 전에 확인
- 공유 미리보기(`og:url`, `og:image`)는 `https://jellydock.com/beta/myvisionvault/` 주소를 가정합니다. 주소가 바뀌면 `index.html` 위쪽 두 줄을 고칩니다.
- 공개 배포는 Owner 승인 후 진행합니다 (L3).
- 페이지 문구는 Owner 결정(2026-11-12)을 반영했습니다: 틀려도 파기 없음(3번 후 1·5·15분, 이후 1시간 대기), 가져오기는 복사만(원본 삭제 없음).
- 영상과 스크린샷은 2026-11-13 main(전체화면 갤러리·사진 검색, 암호화 백업, 두 겹 잠금, 대기 잠금, 복사 전용 가져오기) 기준입니다. 앱 화면이 바뀌면 위 방법으로 다시 찍습니다.
- 개인정보처리방침(`privacy.html`)은 `website/privacy.html`의 백업 문구를 반영하고, 사진 검색 노트 항목을 더했습니다.
