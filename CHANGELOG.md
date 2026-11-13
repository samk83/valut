# CHANGELOG

## [1.1] — 개발 중
### Fixed (2026-11-12, 촬영 깜빡임)
- 앱 카메라로 사진·동영상을 찍을 때 화면이 두 번 깜빡이던 문제: 셔터 깜빡임 뒤 전체 화면 "암호화 중" 덮개가 다시 깜빡였음 → 미리보기 위 작은 표시로 교체 (암호화 중에는 닫기·전환 버튼 잠시 비활성)

### Fixed (2026-11-12, TestFlight 빌드 3 피드백)
- 비밀번호(PIN) 입력 칸의 점·안내 문구가 칸 위쪽에 붙어 보이던 문제 → 세로 가운데 정렬 (처음 설정·확인 입력·잠금 해제 화면 공통 부품 PinDots)

### Changed (2026-11-12)
- 앱 이름 표기를 Private Vision Vault로 통일 (app.json 표시 이름, 옮기기 오류 문구). slug·번들 ID는 그대로
- 첫 화면 "인터넷 접근 없음" → "서버 없음" (11개 언어). 1.1은 새 폰으로 옮길 때 같은 Wi-Fi 직접 연결을 쓰므로

### Added (2026-11-12, 두 겹 잠금)
- 잠금 해제 1단계: 흐린 화면 위에 휴대폰 자체 잠금(Face ID·Touch ID·지문·기기 암호), 통과 시 금색 자물쇠가 열리고 빛이 퍼진 뒤 화면이 밝아지며 2단계 PIN·패턴 화면 (Owner 선택 C안, SPEC AC-08a~d)
- 1단계 실패는 3회 횟수와 무관, 화면 잠금 없는 폰은 1단계 건너뜀 + 안내, 설정에 켜기·끄기 스위치(기본 켜짐)
- 새 부품: expo-local-authentication, expo-blur (다음 네이티브 빌드부터 반영, Expo Go 미리보기 불가)
- 11개 언어 문구 + iOS Face ID 권한 안내문
- 내부 QA 수정: 화면 잠금 판단은 휴대폰 잠금 수준으로만 결정(오류 코드로 건너뛰지 않음), 열리는 애니메이션 중 앱을 나가면 1단계 화면이 사라지던 문제, 앱 복귀 시 다시 확인
- Fixed: PIN 확인 중 앱을 나가면 돌아왔을 때 이미 열려 있을 수 있던 문제 → 다시 잠금 화면으로

### Changed (2026-11-12) — 사진 절대 손실 방지 (Owner 지시: 저장된 사진은 절대 지워지면 안 됨)
- PIN/패턴 3회 오류 파기 제거. 잘못 입력해도 아무것도 지우지 않고, 3회 이후 다음 시도까지 대기 (3회 1분, 4회 5분, 5회 15분, 6회 이상 1시간). 대기는 부팅 후 경과 시간으로 재서 시계 변경으로 줄지 않고, 재부팅 시 처음부터 다시 (core/Lockout.kt, ios/Core/Lockout.swift)
- 잠금 화면: 대기 중 남은 시간 표시·입력 막음, "마지막 기회" 경고 화면 제거. 설정: "잘못 입력 시: 삭제 안 함 · 3회 후 대기"
- 가져오기는 복사만: "원본 삭제" 옵션·화면, 원본 비교(matchesOriginal), iPhone 원본 직접 가져오기(importAsset), expo-media-library(갤러리 삭제 권한) 제거. 결과 화면에서 원본은 사진 앱에서 직접 지우라고 안내. iPhone은 원래 형식(HEIC 등) 그대로 복사
- 첫 설정 동의 문구·경고, 이용약관 2·3·5조(버전 2026-11-12), 테스트 배너, 사진 권한 안내문을 11개 언어로 변경
### Fixed (2026-11-12)
- 맞는 PIN을 넣었는데 시도 횟수 0 초기화 쓰기가 실패하면(저장 공간 부족) 횟수가 올라간 채 남아, 반복되면 PIN 확인 없이 파기되던 문제. 이제 금고가 열리고 횟수도 올라가지 않음
- 설치 표시 파일(installed.marker)만 없어져도 멀쩡한 금고를 "새 설치"로 보고 지우던 위험. 앱 폴더에 금고 파일이 있으면 지우지 않음
- 금고 키가 없을 때 앱 카메라 대기함의 촬영본을 지우던 동작 제거 (다음 금고로 저장)
- 내부 QA 수정: Android 대기 시간이 화면 꺼짐(잠자기) 중에도 흐르도록 elapsedRealtime 사용 / 시도 횟수 두 사본이 다르면 큰 값 사용(한쪽만 고쳐 대기를 건너뛰는 것 방지), 두 번째 사본 쓰기 실패 시 낡은 사본 삭제 / 2분 이내 자동 시간 보정은 재부팅으로 보지 않음 / 대기 끝나면 카운트다운 타이머 정지
### Changed (2026-11-12, website/)
- 웹사이트 이름을 Private Vision Vault로 변경 (영어·한국어, 개인정보처리방침 포함)
- "3회 틀리면 키 파기" 설명을 대기 시간 잠금(1·5·15분, 이후 1시간, 지우지 않음)으로 변경, 휴대폰 화면 그림도 대기 화면으로 교체
- 가져오기를 복사 전용(원본 삭제 없음)으로 설명 변경

### Added (2026-11-12) — App Store ASO
- docs/aso/: 11개 언어 스토어 문구(listing.json → listing.md·store.config.json, build.py가 글자 수·키워드 중복 검사), ASO 전략 문서(ASO.md)
- 스크린샷 자동 촬영(capture.js, 웹 미리보기)·문구 합성(compose.js) 도구. iPhone 6.9형·iPad 13형 × 11개 언어 × 7장 (사진 보호 수정·두 겹 잠금·새 이름 반영)
- 스토어 문구에서 3회 파기·원본 삭제 표현 제거, 대기 시간 잠금·복사 가져오기 기준으로 작성
### Added (2026-11-12)
- 베타 홈페이지 `website/beta/myvisionvault/` (영어): 앱 소개, 50초 사용법 영상(실제 앱 화면), 빠른 시작, 적용 기술, 사용 원칙, 테스트 전 주의사항, TestFlight 참여 안내. TestFlight 링크는 `config.js` 한 곳에 넣으면 버튼이 켜짐
### Changed (2026-11-11)
- 출시 계획: 1.0을 따로 내지 않고 첫 App Store 출시를 1.1로 (무료 100개 + 평생 Premium 인앱 구매 함께 제출). docs/APP_STORE_LISTING.md 설명·가격·제출 체크리스트, NEXT_STEPS.md 출시 순서 수정

### Added (2026-11-10)
- 새 핸드폰으로 옮기기: 같은 Wi-Fi(또는 핫스팟)에서 두 폰을 QR 코드로 직접 연결, 암호화 전송. 서버·클라우드 없음. iPhone ↔ Android 가능 (docs/TRANSFER_PROTOCOL.md)
  - core/Transfer.kt + ios/Core/Transfer.swift: QR 1회용 비밀값 → 방향별 AES-256-GCM 키, 순번 nonce 프레임, 항목마다 SHA-256 확인 후 다음 항목
  - 보내는 폰은 아무것도 지우지 않음. 끊기면 다시 시작해 빠진 것만 받음 (항목마다 봉인된 `source` 기록, 새 폰에서 지운 사진은 다시 받음)
  - 사설 주소(10/172.16/192.168/169.254)만 허용. 손상 항목은 건너뛰고 개수 표시
  - 테스트: Kotlin 전송 10개 + Swift 전송 11개 (Swift 전체 40개) + Kotlin↔Swift 실제 소켓 상호 전송 2개
- 무료 플랜 100개 + 평생 프리미엄 $9.99 (비소모성 `com.jellydock.privatevault.premium`)
  - Apple StoreKit 2 / Google Play Billing 8 직접 사용, 외부 SDK·서버 없음. 구매 복원 버튼(설정·프리미엄 화면)
  - 100개 초과 시 보기·삭제는 그대로, 추가만 막음. 갤러리에서 남은 칸보다 많이 고르면 남은 칸만큼만 가져오고 결과에 표시
  - 결제 창이 떠도 금고가 잠기지 않음 (자동 잠금 예외)
- 화면: 프리미엄, 새 폰 옮기기(QR 표시·스캔·진행·완료), 홈 "N of 100 free" 표시, 설정 Plan·Restore purchases·Move to a new phone
- `npm test` (무료 한도 규칙), ESLint 설정 (`npx expo lint`)
- docs/PREMIUM_SETUP.md (스토어 상품 등록 안내), APP_STORE_LISTING.md 1.1 문구, SPEC AC-70~79·AC-80~86
### Changed (2026-11-11)
- 1.1 새 화면 문구 98개를 언어팩으로 옮기고 10개 언어 번역 (AI 번역), iOS 로컬 네트워크 권한 안내문 번역. 이용약관·첫 화면 경고·설정 문구 변경도 11개 언어에 반영
- Owner 결정: 새 폰 옮기기 무료 확정, iPhone 먼저 출시 (Android는 나중)
### Changed
- Android: INTERNET 권한 사용 (같은 Wi-Fi 직접 연결용). iOS: 로컬 네트워크 권한 안내 문구
- 이용약관·첫 화면 경고: "새 폰으로 옮겨지지 않음" → "설정의 Move to a new phone으로만 옮길 수 있음"
- 설정 보안 표시 "No network access" → "No cloud, no servers"
- 앱 버전 1.1 (Android versionCode 3)

## [Unreleased]
### Added (언어팩, 2026-11-10)
- 앱 화면 문구를 언어팩으로 분리(app/src/i18n). 기기 언어에 맞춰 자동 선택, 없는 언어는 영어
- 11개 언어: 영어, 중국어(간체), 힌디어, 인도네시아어, 포르투갈어(브라질), 러시아어, 일본어, 스페인어, 독일어, 터키어, 한국어 (스마트폰 사용자 상위 10개국 기준 + 한국어)
- 아이폰 권한 안내문(카메라·마이크·사진) 번역(app/locales), 이용약관 번역(영어판 우선 문구 포함)
- 금고 전체 삭제 확인 단어: 각 언어 단어 또는 영어 DESTROY 둘 다 허용
- scripts/check-i18n.js: 빠진 문구·자리표시자·복수형 검사
- 홈 화면 상단 이름을 PrivateVault → Private Vision Vault
### Added (iPhone·iPad, 2026-11-10)
- app/modules/vault-core/ios: 보안 코어 Swift 이식 (Argon2id·AES-256-GCM 조각 암호화·3회 오류 키 파기·이중 저장·촬영본 대기함). 파일 형식·규칙은 Android와 동일
- Argon2id를 Swift로 직접 구현: RFC 9106 시험값, Android(BouncyCastle) 결과와 일치 확인
- IOSHardwareKey: Secure Enclave P-256 키(이 기기 전용, 백업 제외), 시뮬레이터는 소프트웨어 키
- VaultCoreModule.swift: Android와 같은 JS 함수. 재설치 시 Keychain 잔여 키 삭제, 금고 폴더 백업 제외·잠금 중 읽기 불가 보호
- importAsset: 아이폰에서 사진 앱 원본을 그대로 가져와, 원본 삭제 전 SHA-256 일치 확인이 가능
- iPad·iPhone Duo: 화면 너비에 따라 사진 칸 수 조절(3~8칸), 입력 화면은 가운데 정렬, iPad 모든 방향 회전
- 앱 전환기 화면 흐림(iOS)
- app.json: 번들 ID `com.jellydock.privatevault`, 표시 이름 Private Vision Vault, 권한 안내 문구, 개인정보 매니페스트, 암호화 수출 규정 면제 표시. eas.json: 시뮬레이터·미리보기·출시 빌드, App Store 제출(앱 번호 6832844680)
- Swift 코어 단위 테스트 29개 (ios/Package.swift, Mac 없이 실행)
- 첫 설정 동의 체크박스: "3회 오류 = 영구 삭제, 복구 불가" + 이용약관 동의 (Owner 요청). 이용약관 화면(설정에서도 열람), docs/TERMS.md (책임 제한 조항, 변호사 검토 권장)
- docs/APP_STORE_LISTING.md: 사실만 쓴 스토어 문구(영어·한국어), 쓰지 않는 표현 목록, 심사 메모
- 경고문·약관에 "새 핸드폰으로 옮겨지지 않음" 안내 (백업·기기 이전 제외는 SPEC AC-21 설계)
- 스토어 스크린샷 32장: iPhone 6.9형·iPad 13형·iPhone Duo 바깥/안쪽 화면 (프로젝트 파일 privatevault/appstore-screenshots)
### Fixed (iPhone 내부 QA)
- 설정 화면이 아이폰 Secure Enclave를 "Software key"로 잘못 표시하던 문제
- 시뮬레이터·Mac에서 메모리 확인값 0 때문에 잠금 해제가 항상 실패하던 문제
- 손상된 envelope가 큰 메모리를 요구해 앱이 죽으며 시도가 소모될 수 있던 문제 (iOS 상한 256 MiB, 저장된 설정 기준으로 시도 전 메모리 확인)
- 라이브 포토·편집된 사진의 원본 삭제 시 일부가 금고에 없던 문제 (파일 1개짜리 원본만 삭제, 원본 파일 그대로 가져오기)
- iCloud 전용 원본 내려받기 대기로 금고가 멈출 수 있던 문제 (네트워크 사용 안 함, 120초 제한)
- 기기 잠금 중 Keychain을 "키 없음"으로 착각하던 문제, 키 삭제를 항상 시도
- 대기 중인 촬영본에 최강 파일 보호 적용, 큰 촬영본 복사를 조각 단위로
### Added (자료 무손실, SPEC AC-50)
- SPEC: '자료 무손실' 필수 제약 AC-50a~j. core/DataLossTest.kt 자동 테스트 20개로 강제
- 키 envelope·시도 카운터·항목 파일 키·메타데이터를 두 벌 저장, 손상 시 다른 벌로 열고 자동 복구
- 삭제 표시(tombstone): 삭제 도중 꺼져도 다음 실행 때 마무리, 키 한 벌만 남은 항목은 보존
- core/PendingImports.kt: 앱 내 카메라 촬영본 대기함. 저장 실패·앱 종료·방전 시 다음 잠금 해제 때 자동 저장
- 갤러리 원본 삭제 전, 원본을 다시 읽어 금고 사본(복호화)과 SHA-256 완전 일치할 때만 삭제
- PIN 검사 전 메모리 확인: 부족하면 시도로 세지 않음
- 앱 v0.2.0 (versionCode 2), 기존 테스트 빌드 위에 업데이트 설치 가능
### Changed
- 두 envelope가 모두 읽을 수 없는 형태(저장 장치 손상)면 오답으로 세지 않고 KeysUnavailable 처리
### Added
- website/: 1.1 내용 반영 — 새 핸드폰으로 옮기기(같은 Wi-Fi 직접 연결), 네트워크 권한 설명, 100개 무료 + 평생 프리미엄 가격, 11개 언어, iPhone·iPad 먼저 출시. 개인정보처리방침에 로컬 네트워크 권한·구매·옮기기 항목 추가 (영어·한국어)
- website/: 휴대폰 화면 장면을 앱 최종 시안(19개 화면)에 맞춰 갱신 (Welcome, 잠금 해제, 가져오기 진행, 홈 사진·영상 탭, 금고 카메라, 금고 파기)
- website/: 영어를 기본 언어로 전환 (index.html, privacy.html), 한국어 페이지는 website/ko/에 보관 (noindex)
- website/: PrivateVault 소개 웹사이트 (정적 HTML·CSS·JS, Obsidian & Brass 테마, 스크롤 연동 앱 화면 6단계, 보안 기술·한계·기술 사양, 출시 예정 스토어 버튼, 소개 영상 자리)
- website/privacy.html: 개인정보처리방침 (수집 없음, 권한 설명, 파기, 웹사이트 접속 기록)
- website/assets/fonts, tools/fetch_fonts.py: 글꼴 직접 호스팅으로 웹사이트 외부 요청 0건
- iPhone Expo Go 미리보기: EAS 프로젝트 연결(app.json owner·projectId·updates.url, runtimeVersion `exposdk:58.0.0`), EAS Update `preview` 채널·브랜치에 iOS 게시. docs/IOS_PREVIEW.md 한국어 안내. 미리보기 전용(가짜 데이터, 암호화 없음)
- app/: Android 테스트 앱 (Expo SDK 58). PIN 설정·잠금 해제(3회 오류 파기)·최종 시도·파기 화면, 금고 홈, 앱 내 카메라(사진·동영상, 갤러리 저장 안 함), 갤러리 가져오기(원본 삭제 선택), 사진·동영상 보기, 보안 설정·초기화. 화면 캡처 차단, 백그라운드 즉시 잠금, 인터넷 권한 없음, 백업 제외
- app/modules/vault-core: core/ 보안 코어를 그대로 컴파일하는 Expo 네이티브 모듈, Android Keystore HMAC 키(StrongBox 우선, 없으면 TEE)
- docs/ANDROID_TEST_APP.md: 한국어 설치·테스트 안내
### Fixed (Android 테스트 앱 내부 QA)
- 갤러리 가져오기·카메라 촬영 후 앱 캐시에 평문 사본이 남던 문제 (가져온 뒤 삭제, 시작·잠금 때 정리)
- OK 버튼 빠른 두 번 누름으로 시도 2회가 한꺼번에 소모되던 문제
- PIN 만들기 중 백그라운드 전환 시 설정 화면에서 멈추던 문제
- 사진 선택기·권한 창이 열린 채 앱을 나가면 자동 잠금이 꺼지던 문제 (90초 넘으면 복귀 시 잠금)
- 백그라운드 전환 시 잠금 화면 전환이 늦어 사진이 잠깐 보이던 문제
- 예기치 않은 보안칩 오류 시 로딩 화면에서 멈추던 문제
- 원본 삭제가 최신 Android 사진 선택기에서 동작하지 않던 문제
- 카메라 저장 실패를 알리지 않던 문제, 재생 창을 닫은 뒤 복호화된 동영상 파일이 남을 수 있던 문제
- (PR #5 리뷰) 모든 동영상이 열리지 않던 문제, 선택기를 연 채 다른 앱에 머물면 90초가 지나도 잠기지 않던 문제
- core/: Phase 1 Security PoC 공통 보안 코어 (Kotlin). Argon2id + 보안칩 키 + HKDF 키 구조, 3회 오류 키 파기, 조각 단위 파일 암호화, 가져오기 검증, 영구 삭제. 테스트 60개
- docs/POC.md: PoC 구성, 설계 결정, 검증 결과, 실기기 필요 항목
### Changed
- SPEC.md: 외부 사진·영상 앱에서 절대 보이지 않음(AC-47), 스크린샷·녹화 차단(AC-48), 앱 밖 사본 안내(AC-49) 추가 (Owner 요구)
### Fixed (내부 QA 1차 리뷰)
- 기존 금고가 있을 때 금고 생성 시도가 사진을 먼저 지우던 문제
- 검사 중 메모리 부족·보안칩 오류가 시도로 남아 정답 확인 없이 금고가 파기될 수 있던 문제
- 동시에 PIN을 넣으면 3회보다 많이 시도할 수 있던 문제 (스레드·프로세스 잠금)
- 재부팅 후 카운터·가져온 항목이 되돌아갈 수 있던 문제 (폴더 fsync)
- 보안칩 키 일시 조회 실패 시 사진이 지워지던 문제
- 가져오기 검증이 원본과 비교하지 않던 문제 (호출자 SHA-256 대조)
- 가져오기 중 잠금 시 항목이 0 키로 저장될 수 있던 문제, 기타 LOW 항목
### Fixed (PR #4 리뷰)
- PIN 검사 중 잠금(백그라운드 전환)이 들어오면 검사 후 다시 열리던 문제
- 다른 객체가 금고를 파기·재생성한 뒤 오래된 객체로 가져오면 원본 삭제를 허용하던 문제 (마스터키 확인값 대조)
### Fixed (내부 QA 2차 리뷰)
- 파기 도중 강제 종료되면 금고가 막혀 새로 만들 수 없던 문제
- 손상된 동영상 파일을 열 때 파일 핸들이 새던 문제, 충돌로 남은 임시 envelope 사본 삭제
- docs/PRD.md: PrivateVault PRD v1.0 원문 저장
- docs/REVIEW.md: 설계 가능성 및 보안 검토 (Owner 추가 요구사항 R1~R5, 위험 G1~G10, 미해결 8개 항목 권고)
- SPEC.md: 수락 기준 초안 v0.1
- STATUS.md, NEXT_STEPS.md, CHANGELOG.md
### Changed
- SPEC.md: MVP 범위를 사진 + 동영상으로 확정, 동영상 수락 기준 AC-44~46 추가
- docs/REVIEW.md: 6장 재검증 (공식 문서·포렌식 자료) 및 최고 수준 설계 권고 S1~S10 추가, SPEC AC-14·AC-15 추가, PIN 최소 10자리 권고
- SPEC.md: PIN 최소 4자리로 확정 (Owner 결정), 10자리 권장·강도 표시 AC-03a 추가
- iOS·Android 동시 개발 확정 (SPEC, NEXT_STEPS, STATUS 반영)
- SPEC.md: 앱 내 카메라(사진·동영상 촬영) MVP 포함, AC-34~39 추가
- docs/DESIGN.md: 최종 디자인 시안(Obsidian & Brass, 16개 화면) 기록
