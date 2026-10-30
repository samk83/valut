# CHANGELOG

## [Unreleased]
### Added
- core/: Phase 1 Security PoC 공통 보안 코어 (Kotlin). Argon2id + 보안칩 키 + HKDF 키 구조, 3회 오류 키 파기, 조각 단위 파일 암호화, 가져오기 검증, 영구 삭제. 테스트 57개
- docs/POC.md: PoC 구성, 설계 결정, 검증 결과, 실기기 필요 항목
### Fixed (내부 QA 1차 리뷰)
- 기존 금고가 있을 때 금고 생성 시도가 사진을 먼저 지우던 문제
- 검사 중 메모리 부족·보안칩 오류가 시도로 남아 정답 확인 없이 금고가 파기될 수 있던 문제
- 동시에 PIN을 넣으면 3회보다 많이 시도할 수 있던 문제 (스레드·프로세스 잠금)
- 재부팅 후 카운터·가져온 항목이 되돌아갈 수 있던 문제 (폴더 fsync)
- 보안칩 키 일시 조회 실패 시 사진이 지워지던 문제
- 가져오기 검증이 원본과 비교하지 않던 문제 (호출자 SHA-256 대조)
- 가져오기 중 잠금 시 항목이 0 키로 저장될 수 있던 문제, 기타 LOW 항목
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
