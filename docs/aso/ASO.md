# App Store 검색·전환 최적화 (ASO) — Private Vision Vault 1.1

ASO(App Store Optimization)는 App Store에서 **검색에 잘 걸리고**(노출), 상품 페이지를 본 사람이 **실제로 설치하게**(전환) 만드는 작업입니다.
이 폴더가 첫 출시(1.1) 스토어 문구의 기준입니다. `docs/APP_STORE_LISTING.md`의 이름·부제·키워드·설명은 이 폴더 내용으로 바꿔 씁니다 (심사 메모와 제출 체크리스트는 그 문서를 그대로 씀).

| 파일 | 내용 |
|---|---|
| `listing.json` | 11개 언어 문구 원본 (이름, 부제, 키워드, 프로모션 문구, 설명, 인앱 구매 문구, 스크린샷 문구) |
| `listing.md` | App Store Connect에 복사해 넣는 언어별 입력 시트 (자동 생성) |
| `store.config.json` | `eas metadata:push`용 파일 (자동 생성, 웹사이트 주소 입력 후 사용) |
| `build.py` | 글자 수 제한·키워드 중복 검사 후 위 두 파일 생성 |
| `tools/` | 스크린샷 자동 촬영(`capture.js`)·문구 합성(`compose.js`)·예시 그림(`gen_samples.py`) |

## 1. 결정 사항 반영
- 앱 이름: **Private Vision Vault** (Owner 결정 2026-11-12). 홈 화면 이름(`CFBundleDisplayName`)도 같음.
- 3번 틀리면 파기 기능 없음, 대신 대기 시간 증가 (Owner 결정 2026-11-12, 브랜치 `feature/never-lose-photos`). 스토어 문구에 "파기", "영구 삭제", "원본 삭제"를 쓰지 않고, 실제 대기 시간(3번 틀린 뒤 1분 → 5분 → 15분 → 1시간)만 적음.
- 가져오기는 **복사만**. 원본은 사용자가 직접 지움. 앱 카메라로 찍은 것은 앱 안에서만 보임.
- 원칙(2026-11-10): 확인된 사실만. military-grade, unhackable, audited 같은 과장 금지. 구독 아님.
- 두 겹 잠금(PR #14) 문장은 `[2STEP]` 표시. 출시 빌드에 PR #14가 없으면 `TWO_STEP=0`을 붙여 `build.py`와 `tools/compose.js`를 다시 실행 (설명 문장과 스크린샷 2번이 함께 빠짐).
- Android 앱은 아직 출시 전이라 "iPhone과 Android 사이에서도 옮기기 가능"은 넣지 않음 (Android 출시 때 추가).

## 2. 검색 최적화: 이름·부제·키워드
App Store 검색은 **이름(30자) + 부제(30자) + 키워드(100자)** 세 칸만 봅니다. 설명과 프로모션 문구는 검색에 쓰이지 않습니다.

| 규칙 | 적용 |
|---|---|
| 이름이 가장 강함 | 영어: `Private Vision Vault` (private, vault 모두 많이 검색되는 단어). 다른 언어는 뒤에 현지어 핵심어를 붙임 (예: `Private Vision Vault: 사진 금고`) |
| 부제는 두 번째로 강함 | "숨기기 + 잠금 + 사진 + 동영상"을 넣음. 이름과 합쳐져 "photo vault", "hide photos", "lock photos", "video vault"가 모두 만들어짐 |
| 키워드는 쉼표만, 띄어쓰기 없음 | `build.py`가 검사 |
| 이름·부제에 있는 단어를 키워드에 또 쓰지 않음 | 공간 낭비라서 `build.py`가 막음 (한중일·한글은 포함 관계로 검사) |
| 다른 앱·브랜드 이름 금지 | Keepsafe, Keeper, Private Photo Vault 같은 이름은 심사 거절 사유라 키워드에 넣지 않음 |
| 미국 스토어는 English(U.S.) + Spanish(Mexico) 키워드를 함께 씀 | 그래서 es-MX는 스페인어 핵심어로 채움 (미국 내 스페인어 검색도 잡힘) |

경쟁 앱과의 차이(설명·스크린샷에서 강조): 많은 금고 앱이 잠금 화면만 있고 파일을 실제로 암호화하지 않는다는 지적이 있음. 우리 앱은 **AES-256-GCM 실제 암호화, 계정·클라우드·광고 없음, 한 번 결제(구독 아님)**를 앞세움. "one time payment photo vault" 같은 검색 수요가 있음.

## 3. 전환 최적화: 스크린샷
상품 페이지에서 사람들은 **처음 3장**만 보고 결정하는 경우가 많습니다. 그래서 순서를 "무엇을 하는 앱인지 → 왜 안전한지 → 쓰기 쉬운지" 순으로 바꿨습니다. 문구는 `listing.json`의 `shots`.

| 순서 | 화면 | 영어 문구 | 왜 |
|---|---|---|---|
| 1 | 홈(사진 칸) | Hide photos & videos / In a vault only you can open | 검색한 사람이 찾던 것인지 1초 안에 확인 |
| 2 | 두 겹 잠금 | Two locks, not one / Face ID or passcode, then your PIN | 보안 차별점 (PR #14) |
| 3 | 가져오기 | Easy import / Copied in. Originals stay untouched. | 쉬움 + 안심 |
| 4 | 보안 설정 | Nothing leaves your phone / No account, no cloud, no tracking | 개인정보 걱정 해소 |
| 5 | 새 폰 옮기기 | New phone? Bring your vault / Phone to phone over your Wi-Fi. Free. | 기기 변경 걱정 해소 |
| 6 | 프리미엄 | 100 items free / Unlimited with one payment. No subscription. | 가격 투명성 |
| 7 | 첫 화면 | No back door / Not even we can open your vault | 신뢰 |

크기: iPhone 6.9형 1320×2868, iPad 13형 2064×2752 (Apple이 작은 기기용으로 자동 축소). 11개 언어 × 2기기 × 7장.
예시 사진은 그려서 만든 풍경 그림이고 실제 사진이 아닙니다.

**주의**: 지금 스크린샷은 초안입니다. 가져오기 화면·설정 화면·첫 화면에 옛 동작(원본 삭제, 남은 시도 3회, No recovery)이 보입니다. `feature/never-lose-photos`가 합쳐진 뒤 같은 도구로 다시 찍어야 최종본이 됩니다.

## 4. 그 밖의 전환 요소
- **App Privacy(개인정보 라벨)**: "Data Not Collected(수집하는 데이터 없음)"로 신고 (앱에 분석·오류 수집 도구 없음 확인, 제출 전 한 번 더 확인). 상품 페이지에 크게 보이는 신뢰 요소. 결제는 Apple이 처리하므로 앱이 수집하는 것 없음.
- **프로모션 문구(170자)**: 심사 없이 언제든 바꿀 수 있음. 할인·업데이트 소식에 활용.
- **인앱 구매 현지화**: Lifetime Premium의 표시 이름은 앱 화면과 같게 모든 언어 `Lifetime Premium`, 설명은 언어별(45자 이내). 스토어 페이지 "In-App Purchases"에 보임.
- **평점 요청(추천, 미구현)**: 사진을 처음 금고에 넣은 직후 같은 좋은 순간에 Apple 기본 평점 창(SKStoreReviewController)을 띄우면 평점 수가 빨리 늘어 검색 순위에 도움. 앱 코드 변경이라 별도 승인 필요.
- **카테고리**: 1순위 Utilities, 2순위 Photo & Video (기존과 같음).

## 5. 출시 전 확인할 위험
| 항목 | 내용 | 할 일 |
|---|---|---|
| 웹사이트 주소 | 개인정보처리방침 URL과 지원 URL이 필수 | 소개 웹사이트 공개 후 주소 입력 |
| 중국 본토 | 중국 App Store는 ICP 비안 번호(중국 정부 등록번호)를 요구. 캐나다 개인사업자는 받기 어려움 | Pricing and Availability에서 China mainland 판매 끄기 권장 (중국어 문구는 싱가포르·말레이시아 등 다른 나라 중국어 사용자에게도 쓰임) |
| 번역 | 10개 언어 문구는 AI 번역 | 가능하면 원어민 확인, 특히 일본어·독일어 |
| 두 겹 잠금 | PR #14 미합류 시 | `TWO_STEP=0`으로 문구·스크린샷 다시 만들기 |

## 6. 입력 방법
**방법 A — 직접 복사 (가장 쉬움)**: `listing.md`를 열고, App Store Connect → 앱 → iOS App 1.1 화면에서 언어를 바꿔 가며 칸마다 붙여넣기. 언어 추가는 화면 오른쪽 위 언어 메뉴 → **Add Language**.

**방법 B — 한 번에 올리기 (EAS Metadata)**: 웹사이트 주소가 생기면
```
cd app
py ..\docs\aso\build.py
copy ..\docs\aso\store.config.json store.config.json
eas metadata:push
```
(Windows 명령. 먼저 `eas submit`으로 빌드를 한 번 올려야 함. 스크린샷은 이 방법으로 올라가지 않으므로 App Store Connect에서 직접 끌어다 놓기.)

## 7. 출시 후
- 4주 뒤 App Store Connect → **App Analytics**에서 검색 노출·전환율 확인 후 약한 키워드 교체 (키워드 변경은 새 버전 제출 때만 가능).
- **Product Page Optimization**: 스크린샷 순서·문구를 A/B 테스트 (무료, Apple 기본 기능).
- **Custom Product Pages**: "새 폰 옮기기", "구독 없는 금고" 같은 주제별 페이지 (광고 연결용).
- Apple Search Ads(유료 광고)는 비용이 드니 Owner 승인 후.

## 8. 다시 만들기 (개발용)
1. 앱 웹 빌드: `app`에서 `npx expo install react-dom react-native-web @expo/metro-runtime` 후 `npx expo export -p web`. 스크린샷 전용으로만 임시 수정(커밋하지 않음): DemoVault `hardware: 'SECURE_ENCLAVE'`, `readLockMethod` 기본값 `'pin'`, Premium 화면 App Store 문구·버튼 활성, DeviceGate는 첫 화면에서 멈춤.
2. 앱 문구 추출: `node --experimental-strip-types`로 `app/src/i18n/*.ts`를 읽어 `i18n.json` 생성.
3. `python3 tools/gen_samples.py <work>/samples` 후 ffmpeg로 짧은 동영상 4개.
4. 빌드 폴더를 `localhost:8765`로 띄우고 `node tools/capture.js <work>` → `node tools/compose.js <work>/raw <out> Fraunces.ttf`.
