# STATUS — JellyDock PrivateVault

Last Updated: 2026-10-30 (iPhone Expo Go 미리보기)

| Task / Thread | Status | Progress | Last Updated | Next Action | Owner Action | Branch |
|---|---|---|---|---|---|---|
| PRD 문서화 + 설계·보안 검토 | DONE | PR #1 Merge 완료 | 2026-10-30 | - | - | main |
| SPEC 승인 | BLOCKED | 초안 작성 | 2026-10-30 | Owner 승인 후 확정 | SPEC 승인 (확정: 사진+동영상, PIN 4자리+, iOS·Android 동시, 앱 내 카메라 포함) | - |
| Phase 1 Security PoC — 공통 보안 코어 | DONE | 코어 구현 + 테스트 60개 통과, PR #4 Merge 완료 | 2026-10-30 | - | - | main |
| Phase 1 Security PoC — 실기기 (Android/iOS 보안칩) | BLOCKED | 0 | 2026-10-30 | Android SDK 받기 / iOS 빌드 경로 결정 | `dl.google.com` 허용, Mac 여부 결정 | - |
| Phase 2 UI/UX 디자인 | DONE | 최종 시안 16개 화면 승인 (docs/DESIGN.md) | 2026-10-30 | 잠금 화면 점 표시를 입력 자릿수만큼으로 수정 | - | - |
| Android 테스트 앱 (APK) | DONE (실기기 검증 대기) | Expo 앱 + 보안 코어 연결, APK 빌드, 내부 QA 11건·PR 리뷰 2건 수정, PR #5 Merge | 2026-10-30 | Owner 실기기 설치·확인 | 실기기 테스트 결과 알려주기 | main |
| iPhone Expo Go 미리보기 (가짜 데이터·암호화 없음) | REVIEW | EAS Update 게시 완료 (SDK 58, 채널 preview), 서버 응답 확인. 실제 iPhone 실행은 미확인 | 2026-10-30 | Owner iPhone에서 열어보기 | Expo Go로 열어보고 결과 알려주기 (docs/IOS_PREVIEW.md) | feature/ios-preview |
| 자료 무손실 설계 + 제약 (AC-50) | REVIEW | 이중 저장·자동 복구·촬영본 대기함·원본 일치 확인 구현, 테스트 80개 통과, 내부 QA 8건 수정, APK v0.2.0 | 2026-10-30 | 내부 QA 후 PR | 실기기 확인 | fix/no-data-loss |
| Phase 3 MVP 개발 | TODO | 0 (미착수) | 2026-10-30 | 디자인 승인 후 | 개발 승인 | - |
| 외부 보안 감사 | TODO | 0 | 2026-10-30 | 견적 조사 | 비용 승인 (L3) | - |

GitHub Actions: 사용하지 않음.
