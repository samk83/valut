# NEXT STEPS — JellyDock PrivateVault

## Owner 결정 필요
1. MVP 범위: 사진만 / 사진+동영상 / PRD 전체 (동영상·PDF·폴더 포함)
2. 첫 출시 OS: iOS 먼저 / Android 먼저 / 동시
3. SPEC.md 초안 승인 (특히 PIN 최소 6자리, 3회 오류 = 키 파기 정책)

## 권장 순서
1. SPEC 승인
2. Phase 1 Security PoC (네이티브, 실기기 1~2대)
   - Argon2id + 보안칩 키 결합으로 마스터키 보호
   - 3회 오류 시 키 파기, 강제 종료 공격 방지 카운터
   - 재설치 시 잔존 Keychain 삭제 검증
   - 백업·기기 이전 제외 검증
   - Android StrongBox 키 사용 횟수 제한 실험
3. Phase 2 UI/UX 디자인 → Owner 승인
4. Phase 3 MVP 개발
5. Phase 4 Security QA + 외부 감사 (예산 승인 후)
6. Phase 5 출시
