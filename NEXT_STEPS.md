# NEXT STEPS — JellyDock PrivateVault

## Owner 결정 필요
1. ~~MVP 범위~~ → 확정: 사진 + 동영상 (2026-10-30)
2. ~~첫 출시 OS~~ → 확정: iOS·Android 동시 개발 (2026-10-30)
3. SPEC.md 초안 승인 (PIN 최소 4자리. 2026-11-12 변경: 3회 오류 파기 → 대기 시간, 가져오기는 복사만)
4. ~~iOS 빌드 경로~~ → 확정: Android 먼저, iPhone은 Expo로 확인 (2026-10-30)
5. Android SDK 다운로드를 위해 클라우드 환경에서 `dl.google.com` 허용 (선택)

## 전체화면 갤러리 + 사진 검색 (2026-11-12)
- 시안: https://claude.ai/artifact/PrfdHManevnCtn5apLQsVn
- Owner: PR 확인 후 Merge → 다음 iPhone 빌드(TestFlight)에서 확인
- 실기기 확인: 영수증·메뉴판·화면 캡처 사진으로 한국어/영어 검색, 사진 보기 [글자] 박스 위치, 사진 많을 때 검색 준비 속도·배터리
- 다음 단계 추천: 동영상 속 글자 검색, 설정에 "사진 검색 끄기"·"충전 중에만 읽기", 사진 옮기기·백업 후 검색 노트 다시 만들기 안내
- 알려진 한계: iPhone 글자 인식은 힌디어 미지원(Apple), Android는 러시아어(키릴 문자) 미지원(ML Kit)
- Android 출시 전 확인: Google ML Kit은 사진·글자는 보내지 않지만 익명 사용 통계 모듈(datatransport)을 함께 넣음. 이 모듈은 이미 Play 결제·QR 카메라 때문에 앱에 들어 있음. Android 출시 전에 네트워크 기록으로 실제 전송 여부 확인 후 차단 방법 결정 (iPhone은 해당 없음)
- APK 크기: ML Kit 글자 모델 때문에 Android 앱이 약 60MB(arm64)로 커짐. 필요하면 언어별 모델 줄이기

## 사진 절대 손실 방지 (2026-11-12)
- 점검 보고서: https://claude.ai/artifact/WhDrx6E4QTyYEeDRoDdoWo
- Owner: PR 확인 후 Merge (PR #14 두 겹 잠금과 App.tsx·Settings.tsx·언어팩이 겹침 → 나중에 Merge하는 쪽에서 충돌 정리)
- 실기기 확인: 3회 틀린 뒤 1분 대기 화면, 대기 중 입력 막힘, 재부팅 후 대기 다시 시작, 가져오기 후 원본이 갤러리에 그대로 있는지
- 웹사이트(PR #16)·스토어 문구(docs/aso)도 같은 내용으로 맞춤 (다른 스레드)
- 남은 위험(앱이 막을 수 없음): 앱 삭제, 휴대폰 분실·초기화, PIN 분실 → 설치 안내·첫 화면에 안내 중

## iPhone·iPad 출시 (2026-11-10, 2026-11-11 갱신)
- **Owner 결정 (2026-11-11): 1.0을 따로 내지 않고 첫 출시를 1.1로 한 번에** (100개 무료 → 평생 프리미엄 결제). main에서 빌드(app.json version 1.1), App Store Connect 버전도 1.1, 인앱 구매 `com.jellydock.privatevault.premium`을 첫 버전과 함께 심사 제출 (docs/APP_STORE_LISTING.md 체크리스트)
- 제출 전 막는 조건: Paid Apps 계약 Active 필요(2026-11-11 은행 계좌 Processing → Pending), EU DSA 판매자 상태 In Review
- 출시 가이드: https://claude.ai/artifact/Y2XDe2fSG5gnmMCyQgZrcU (App Store Connect 앱 등록 완료, 앱 번호 6832844680)
- Owner: PC에서 `cd valut` → `git pull` → `cd app` → `npm install` → `npx eas-cli build --platform ios --profile production` (Apple 로그인 1회) → `npx eas-cli submit --platform ios --latest` → TestFlight로 아이폰·아이패드 확인
- 실기기 확인: Secure Enclave 표시, PIN 확인 시간(Argon2 64 MiB), 사진 앱에서 복사 가져오기(원본 유지), 카메라, 아이패드 회전·분할 화면
- 정식 심사 제출 전 결정: 화면 상단 "TEST BUILD" 경고 문구 제거 여부, 외부 보안 감사(Phase 4) 전 출시 여부 (Owner 결정)
- 개인정보처리방침 URL: 소개 웹사이트(PR #3) 공개 필요 (GitHub Pages, Owner 승인)
- 2027년 4월부터 iOS 27.1 SDK 이상 빌드는 iPhone Duo 스크린샷 필수 (준비됨)
- 새 핸드폰으로 금고 옮기기: 1.1에 포함되어 첫 출시에 들어감 (아래 1.1 항목, SPEC AC-70~79)

## App Store ASO (2026-11-12)
- 스토어 문구 원본: docs/aso/listing.json, 입력 시트: docs/aso/listing.md, 설명: docs/aso/ASO.md
- 스크린샷 154장: 프로젝트 파일 privatevault/appstore-screenshots-1.1/ (PR #19·#14·#15 합친 화면). 세 PR 중 출시에서 빠지는 것이 있으면 다시 촬영
- PR #14 미합류 시 `TWO_STEP=0 python3 docs/aso/build.py` + 스크린샷 2번 제외
- Owner: 웹사이트 공개 후 개인정보처리방침·지원 URL 입력, 중국 본토 판매 끄기 여부 결정(ICP 번호 필요)
- 추천(미구현, 승인 필요): 첫 가져오기 후 평점 요청 창

## 1.1 프리미엄 + 새 폰 옮기기 (2026-11-10)
- Owner 결정 (2026-11-11): 새 폰 옮기기 무료 확정. iPhone·iPad 먼저 출시, Android 출시는 나중
- Owner: App Store Connect에 상품 등록 — docs/PREMIUM_SETUP.md 1장 (유료 앱 계약·상품). Play Console 상품 등록은 Android 출시 때
- 실기기 확인: 100개 제한, 샌드박스 구매·복원, 두 폰 옮기기(iPhone→iPhone, Android→iPhone, iPhone→Android), 옮기는 중 Wi-Fi 끊김 후 이어 받기
- 출시 순서: PR #6~#10 Merge 완료(2026-11-11) → main에서 iPhone 1.1 빌드 → TestFlight 확인 → Paid Apps Active 확인 → 1.1 + 인앱 구매 함께 심사 제출 (L3 승인)
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

## 두 겹 잠금 (2026-11-12)
- 시안: https://claude.ai/artifact/RdAJ3TwzJLkfFqeoKnqEum (Owner 선택: C안 자물쇠 열림 효과)
- 실기기 확인 필요 (다음 iPhone 빌드·TestFlight): Face ID 통과·취소·실패 반복, 기기 암호로 대신 열기, 2단계에서 홈으로 나갔다 오기, 화면 잠금 없는 기기, 설정 스위치 끄기
- Android: 흐림 효과는 어두운 반투명 화면으로 보임(실제 흐림은 Android 출시 때 다듬기)

## 베타 홈페이지 (2026-11-12)
- 위치: `website/beta/myvisionvault/` (폴더 하나만 올리면 동작). 안내: 그 폴더의 README.md
- Owner: jellydock.com을 어디서 관리하는지 알려주기 → 올리는 방법 안내 → 배포 승인(L3)
- TestFlight 외부 테스트 공개 링크가 생기면 `config.js`에 넣기
- 페이지 문구는 새 방침(파기 없음·대기 잠금, 복사 전용) 반영 완료. 앱 수정과 PR #15 Merge 후 새 스크린샷으로 영상·화면 이미지 다시 만들기
- 홍보용 추가 제안: 세로(9:16) 영상, 실제 폰을 다른 기기로 촬영한 영상, 영어 내레이션
