# NEXT STEPS — JellyDock PrivateVault

## Owner 결정 필요
1. ~~MVP 범위~~ → 확정: 사진 + 동영상 (2026-10-30)
2. ~~첫 출시 OS~~ → 확정: iOS·Android 동시 개발 (2026-10-30)
3. SPEC.md 초안 승인 (PIN 최소 4자리, 3회 오류 = 키 파기 정책)
4. ~~iOS 빌드 경로~~ → 확정: Android 먼저, iPhone은 Expo로 확인 (2026-10-30)
5. Android SDK 다운로드를 위해 클라우드 환경에서 `dl.google.com` 허용 (선택)

## iPhone·iPad 출시 (2026-11-10)
- 출시 가이드: https://claude.ai/artifact/Y2XDe2fSG5gnmMCyQgZrcU (App Store Connect 앱 등록 완료, 앱 번호 6832844680)
- Owner: PC에서 `cd valut\app` → `npm install` → `npx eas-cli build --platform ios --profile production` (Apple 로그인 1회) → `npx eas-cli submit --platform ios --latest` → TestFlight로 아이폰·아이패드 확인
- 실기기 확인: Secure Enclave 표시, PIN 확인 시간(Argon2 64 MiB), 사진 앱 원본 가져오기·삭제, 카메라, 아이패드 회전·분할 화면
- 정식 심사 제출 전 결정: 화면 상단 "TEST BUILD" 경고 문구 제거 여부, 외부 보안 감사(Phase 4) 전 출시 여부 (Owner 결정)
- 개인정보처리방침 URL: 소개 웹사이트(PR #3) 공개 필요 (GitHub Pages, Owner 승인)
- 2027년 4월부터 iOS 27.1 SDK 이상 빌드는 iPhone Duo 스크린샷 필수 (준비됨)
- 1.1 계획 (Owner 결정 2026-11-10): 새 핸드폰으로 금고 옮기기 → 개발함 (아래 1.1 항목, SPEC AC-70~79)

## 1.1 프리미엄 + 새 폰 옮기기 (2026-11-10)
- Owner 결정 (2026-11-11): 새 폰 옮기기 무료 확정. iPhone·iPad 먼저 출시, Android 출시는 나중
- Owner: App Store Connect에 상품 등록 — docs/PREMIUM_SETUP.md 1장 (유료 앱 계약·상품). Play Console 상품 등록은 Android 출시 때
- 실기기 확인: 100개 제한, 샌드박스 구매·복원, 두 폰 옮기기(iPhone→iPhone, Android→iPhone, iPhone→Android), 옮기는 중 Wi-Fi 끊김 후 이어 받기
- 출시 순서: PR #7 → #6 → #8 → #9 Merge 완료(2026-11-11) → #10 Merge 완료(2026-11-11) → iPhone 빌드·심사 제출 (L3 승인)
- 언어팩 통합 완료 (2026-11-11): 1.1 문구 98개를 11개 언어로 번역(AI 번역, 원어민 검토 권장)
- 남은 개선: Android 17 로컬 네트워크 권한 대응(대상 SDK 37 올릴 때), 구매 영수증 서명 확인(현재 스토어 앱 결과 신뢰), 대용량(수천 개) 옮기기 실측

## 앱 언어팩 (2026-11-10)
- 원어민 검토 권장: 특히 이용약관 번역(법률 문구). 번역본에는 "영어판이 우선" 문구가 들어 있음
- 새 언어 추가: app/src/i18n/en.ts를 기준으로 XX.ts 작성 → index.ts PACKS에 추가 → app.json supportedLocales·locales 추가 → `node scripts/check-i18n.js XX`
- App Store Connect 스토어 문구도 같은 언어로 추가하면 해당 나라 검색 노출에 유리 (docs/APP_STORE_LISTING.md는 현재 영어·한국어)
- 아랍어·우르두어 같은 오른쪽→왼쪽 언어는 패턴 잠금 좌우 반전 위험 때문에 제외 (supportsRTL false)

## Android 테스트 앱 (2026-10-30)
- Owner: APK 설치 후 docs/ANDROID_TEST_APP.md 표의 10개 항목 확인, 결과(특히 설정 화면의 StrongBox/TEE, PIN 확인 시간) 알려주기
- 남은 개선: 동영상 임시 파일 없는 스트리밍 재생, 패턴 잠금, 한국어 문구, Argon2 비용 실측 후 조정, 녹화 중 바로 암호화

## 웹사이트 (website/)
- 한국어 버전 공개: website/ko/ 의 noindex 제거, 언어 전환 링크 추가 (Owner가 원할 때)
- 실제 소개 영상 제작 후 `website/assets`에 추가
- 앱 Welcome 화면 문구 "no internet access"(app/src/i18n `welcome.nothingSub`)가 1.1 옮기기 기능과 맞지 않음: 앱 문구를 "no servers"로 고칠지 검토 (웹사이트 화면 그림은 이미 "no servers"로 수정)
- 브랜드 표기 정리: 웹사이트는 "PrivateVault", 스토어 이름은 "Private Vision Vault" — 통일 여부 Owner 결정
- 출시 시 스토어 링크·지원 OS 버전·가격 입력
- 개인정보처리방침의 [ ] 항목 입력 (시행일, 사업자 정보, 보호책임자, 연락처 이메일, 호스팅 업체)
- 호스팅 선택·배포 (L3: Owner 승인 필요, 무료 옵션 우선 검토)

## 권장 순서
1. SPEC 승인
2. Phase 1 Security PoC (네이티브, 실기기 1~2대) — 공통 코어 완료(core/), 아래는 실기기 단계
   - Android `HardwareKey`: Keystore HMAC + StrongBox + ROLLBACK_RESISTANCE
   - iOS `HardwareKey`: Secure Enclave P-256 ECDH (Swift로 코어 규칙 이식)
   - PIN 검사 전 남은 메모리 확인 (세 번째 시도 중 강제 종료 = 파기 규칙 때문)
   - Argon2id + 보안칩 키 결합으로 마스터키 보호
   - 3회 오류 시 키 파기, 강제 종료 공격 방지 카운터
   - 재설치 시 잔존 Keychain 삭제 검증
   - 백업·기기 이전 제외 검증
   - Android StrongBox 키 사용 횟수 제한 실험
   - 동영상 청크 암호화 + 평문 캐시 없는 스트리밍 재생 (AVAssetResourceLoader / ExoPlayer DataSource)
   - 앱 내 카메라: 녹화 중 청크 암호화 (평문 임시 파일 없이)
3. Phase 2 UI/UX 디자인 → Owner 승인
4. Phase 3 MVP 개발
5. Phase 4 Security QA + 외부 감사 (예산 승인 후)
6. Phase 5 출시
