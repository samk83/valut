# PrivateVault 소개 웹사이트

정적 웹사이트(HTML·CSS·JS 파일만, 빌드 도구 없음)입니다. 디자인은 앱 최종 시안 **Obsidian & Brass**([docs/DESIGN.md](../docs/DESIGN.md))를 따릅니다.

기본 언어는 **영어**입니다 (Owner 결정 2026-10-30). 한국어 페이지는 `ko/`에 보관 중이며, 아직 링크하지 않았고 검색엔진 노출을 막아 두었습니다(`noindex`).

## 구성
- `index.html` — 영어 소개 페이지 (히어로 · 소개 영상 · 작동 방식 스크롤 · 보안 기술 · 알아두실 점 · 기술 사양 · 다운로드)
- `styles.css` — 디자인 토큰과 스타일
- `script.js` — 스크롤에 따라 휴대폰 화면 전환, 모바일용 화면 복제, 영상 자리 안내 (외부 요청·추적 없음)
- `privacy.html` — 영어 개인정보처리방침 (스토어 등록 시 이 주소를 입력)
- `ko/index.html`, `ko/privacy.html` — 한국어 버전 (보관용, 나중에 공개)
- `assets/favicon.svg` — 앱 아이콘 "The Dial"
- `assets/fonts/` — 글꼴 파일 (직접 호스팅, 외부 요청 0건)
- `tools/fetch_fonts.py` — 글꼴 다시 받기. 한국어 문구를 바꾸면 실행: `python website/tools/fetch_fonts.py`

## 내 컴퓨터에서 보기 (Windows)
```
cd website
python -m http.server 8000
```
브라우저에서 http://localhost:8000 을 엽니다. (`index.html`을 더블클릭해도 대부분 보입니다.)

## 출시 전에 바꿀 곳
| 항목 | 위치 | 할 일 |
|---|---|---|
| 스토어 버튼 | `index.html` 의 `.store` 버튼 2곳 × 2섹션 | `<button disabled>`를 스토어 주소 `<a href>`로 교체, 공식 배지 사용 시 Apple·Google 배지 가이드 준수 |
| 소개 영상 | `index.html` 의 `.film-frame` 주석 | `assets/privatevault-intro.mp4`, `assets/film-poster.jpg`를 넣고 주석 해제 |
| 미정 사양 | `[출시 때 공개]` 표시 | 지원 OS 버전, 가격 입력 |
| 개인정보처리방침 | `privacy.html` 의 `[ ]` 표시 | 시행일, 사업자 정보, 보호책임자, 연락처 이메일, 호스팅 업체 입력 |
| 한국어 문구 수정 후 | `tools/fetch_fonts.py` | 새 글자가 글꼴에 들어가도록 다시 실행 |

배포(호스팅)는 아직 하지 않았습니다. 배포는 Owner 승인 후 진행합니다.
