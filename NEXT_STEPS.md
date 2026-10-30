# NEXT STEPS — JellyDock PrivateVault

## Owner 결정 필요
1. ~~MVP 범위~~ → 확정: 사진 + 동영상 (2026-10-30)
2. ~~첫 출시 OS~~ → 확정: iOS·Android 동시 개발 (2026-10-30)
3. SPEC.md 초안 승인 (PIN 최소 4자리, 3회 오류 = 키 파기 정책)
4. ~~iOS 빌드 경로~~ → 확정: Android 먼저, iPhone은 Expo로 확인 (2026-10-30)
5. Android SDK 다운로드를 위해 클라우드 환경에서 `dl.google.com` 허용 (선택)

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
