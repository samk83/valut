# NEXT STEPS — JellyDock PrivateVault

## Owner 결정 필요
1. ~~MVP 범위~~ → 확정: 사진 + 동영상 (2026-10-30)
2. 첫 출시 OS: iOS 먼저 / Android 먼저 / 동시
3. SPEC.md 초안 승인 (특히 PIN 최소 6자리, 3회 오류 = 키 파기 정책)

## 웹사이트 (website/)
- 한국어 버전 공개: website/ko/ 의 noindex 제거, 언어 전환 링크 추가 (Owner가 원할 때)
- 실제 소개 영상 제작 후 `website/assets`에 추가
- 출시 시 스토어 링크·지원 OS 버전·가격 입력
- 개인정보처리방침의 [ ] 항목 입력 (시행일, 사업자 정보, 보호책임자, 연락처 이메일, 호스팅 업체)
- 호스팅 선택·배포 (L3: Owner 승인 필요, 무료 옵션 우선 검토)

## 권장 순서
1. SPEC 승인
2. Phase 1 Security PoC (네이티브, 실기기 1~2대)
   - Argon2id + 보안칩 키 결합으로 마스터키 보호
   - 3회 오류 시 키 파기, 강제 종료 공격 방지 카운터
   - 재설치 시 잔존 Keychain 삭제 검증
   - 백업·기기 이전 제외 검증
   - Android StrongBox 키 사용 횟수 제한 실험
   - 동영상 청크 암호화 + 평문 캐시 없는 스트리밍 재생 (AVAssetResourceLoader / ExoPlayer DataSource)
3. Phase 2 UI/UX 디자인 → Owner 승인
4. Phase 3 MVP 개발
5. Phase 4 Security QA + 외부 감사 (예산 승인 후)
6. Phase 5 출시
