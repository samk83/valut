# STATUS — JellyDock PrivateVault

Last Updated: 2026-11-12 (두 겹 잠금 C안 + 사진 보호: 잘못 입력 파기 제거·복사만 가져오기)

| Task / Thread | Status | Progress | Last Updated | Next Action | Owner Action | Branch |
|---|---|---|---|---|---|---|
| PRD 문서화 + 설계·보안 검토 | DONE | PR #1 Merge 완료 | 2026-10-30 | - | - | main |
| SPEC 승인 | BLOCKED | 초안 작성 | 2026-10-30 | Owner 승인 후 확정 | SPEC 승인 (확정: 사진+동영상, PIN 4자리+, iOS·Android 동시, 앱 내 카메라 포함) | - |
| Phase 1 Security PoC — 공통 보안 코어 | DONE | 코어 구현 + 테스트 60개 통과, PR #4 Merge 완료 | 2026-10-30 | - | - | main |
| Phase 1 Security PoC — 실기기 (Android/iOS 보안칩) | BLOCKED | 0 | 2026-10-30 | Android SDK 받기 / iOS 빌드 경로 결정 | `dl.google.com` 허용, Mac 여부 결정 | - |
| Phase 2 UI/UX 디자인 | DONE | 최종 시안 16개 화면 승인 (docs/DESIGN.md) | 2026-10-30 | 잠금 화면 점 표시를 입력 자릿수만큼으로 수정 | - | - |
| Android 테스트 앱 (APK) | DONE (실기기 검증 대기) | Expo 앱 + 보안 코어 연결, APK 빌드, 내부 QA 11건·PR 리뷰 2건 수정, PR #5 Merge | 2026-10-30 | Owner 실기기 설치·확인 | 실기기 테스트 결과 알려주기 | main |
| iPhone Expo Go 미리보기 + 승인 시안(19화면) 적용 | REVIEW | 시안 승인(10-31) 후 전 화면 시안대로 구현, 내부 QA 2회(각 5건·3건) 수정, 재게시. 실기기 확인 전 | 2026-10-31 | Owner iPhone 확인 | Expo Go로 다시 열어 확인 (PR #6·#7 Merge 완료) | main |
| 자료 무손실 설계 + 제약 (AC-50) | REVIEW | 이중 저장·자동 복구·촬영본 대기함·원본 일치 확인 구현, 테스트 80개 통과, 내부 QA 8건 수정, APK v0.2.0 | 2026-10-30 | PR #7 Merge 완료 | 실기기 확인 | main |
| iPhone·iPad 앱 (App Store 출시 준비) | DONE (실기기 검증 대기) | 보안 코어 Swift 이식(테스트 27개 통과, Argon2 결과 Android와 동일), Secure Enclave 키, iOS 네이티브 모듈, iPad·Duo 화면 대응, app.json·eas.json, 출시 가이드 | 2026-11-10 | EAS 빌드 → TestFlight (PR #8 Merge 2026-11-11, main) | 첫 `eas build` 실행(Apple 로그인 1회), TestFlight 실기기 확인, 정식 심사 제출 승인(L3) | main |
| 1.1 프리미엄(100개 무료 + $9.99 평생) + 새 폰 옮기기 | REVIEW | 전송 코어 Kotlin·Swift(테스트 + Android↔iPhone 상호 전송 통과), StoreKit 2·Play Billing 8 결제, 100개 제한·구매·복원·QR 옮기기 화면, Android 빌드 | 2026-11-11 | PR #10 Merge 완료 (main, 1.1 문구 11개 언어 포함). Owner 결정 2026-11-11: 옮기기 무료, iPhone 먼저 출시·Android는 나중, 첫 출시 = 1.1(인앱 구매 함께 제출). 다음: iPhone 1.1 빌드 → TestFlight → Paid Apps Active 확인 후 제출 | App Store Connect에 상품 등록(docs/PREMIUM_SETUP.md 1장, Apple 로그인 필요), 실기기 확인 | main |
| 앱 언어팩 (스마트폰 사용자 상위 10개국 + 한국어) | DONE (원어민 검토 권장) | 앱 문구 약 250개를 언어팩으로 분리, 11개 언어(영어·중국어 간체·힌디어·인도네시아어·포르투갈어(브라질)·러시아어·일본어·스페인어·독일어·터키어·한국어), 기기 언어 자동 선택, iOS 권한 안내문·이용약관 번역 | 2026-11-11 | PR #9 Merge 완료 (main) | 원어민 검토 권장(특히 이용약관), 실기기 확인 | main |
| 두 겹 잠금 (휴대폰 잠금 → 앱 PIN·패턴, C안) | REVIEW | 구현 + 11개 언어, 타입·언어팩·테스트 통과, Lint 새 오류 0건, 내부 QA 리뷰 11건 확인·주요 7건 수정 | 2026-11-12 | PR Merge 후 다음 iPhone 빌드에 포함 | PR 확인·Merge, TestFlight 실기기 확인 | feature/two-step-unlock |
| 사진 절대 손실 방지 (점검 + 수정) | REVIEW | 점검 보고서 작성 → Owner 결정(파기 대신 대기 시간, 복사만 가져오기) → 구현: 대기 시간 잠금(1·5·15·60분), 맞는 PIN 횟수 버그 수정, 새 설치 판단 안전장치, 원본 삭제 기능·권한 제거, 11개 언어·약관. Kotlin 테스트 96개·Swift 42개·앱 테스트 5개·Android 컴파일 통과, 내부 QA 필수 2건 수정 | 2026-11-12 | PR 검토 → Merge, iPhone TestFlight 빌드에 포함 | PR 확인·Merge, 실기기에서 대기 시간 화면 확인 | feature/never-lose-photos |
| Phase 3 MVP 개발 | TODO | 0 (미착수) | 2026-10-30 | 디자인 승인 후 | 개발 승인 | - |
| 소개 웹사이트 | DONE (미배포) | 영어 기본 소개 페이지 + 개인정보처리방침 + 글꼴 직접 호스팅 (한국어는 ko/ 보관). 1.1 내용(새 핸드폰으로 옮기기, 100개 무료 + 평생 프리미엄 $9.99, 11개 언어, iPhone 먼저 출시) 반영, PR #3 main 머지. 2026-11-12: 이름을 Private Vision Vault로 변경, 틀린 입력은 대기 시간(파기 없음)·가져오기는 복사 전용으로 문구 변경 | 2026-11-12 | 공개 배포 (Owner 승인 후) | 배포 방식 승인 (L3), 방침의 연락처 이메일·사업자 정보·시행일 [ ] 항목 | main |
| App Store ASO (검색·전환 최적화) | REVIEW | 이름 Private Vision Vault 확정 반영, 11개 언어 이름·부제·키워드·설명·프로모션·인앱 구매 문구(글자 수 자동 검사), 스크린샷 7장 순서·문구, 자동 촬영·합성 도구, EAS Metadata 파일 (docs/aso/) | 2026-11-12 | 스크린샷 154장 완료 (PR #19·#14·#15 화면). Owner 문구 확인 후 Merge | 문구 확인, 웹사이트 주소, 중국 본토 판매 여부 | docs/aso-listing |
| 외부 보안 감사 | TODO | 0 | 2026-10-30 | 견적 조사 | 비용 승인 (L3) | - |

GitHub Actions: 사용하지 않음.
