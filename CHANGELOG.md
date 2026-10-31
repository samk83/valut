# CHANGELOG

## [Unreleased]
### Added
- website/: 휴대폰 화면 장면을 앱 최종 시안(19개 화면)에 맞춰 갱신 (Welcome, 잠금 해제, 가져오기 진행, 홈 사진·영상 탭, 금고 카메라, 금고 파기)
- website/: 영어를 기본 언어로 전환 (index.html, privacy.html), 한국어 페이지는 website/ko/에 보관 (noindex)
- website/: PrivateVault 소개 웹사이트 (정적 HTML·CSS·JS, Obsidian & Brass 테마, 스크롤 연동 앱 화면 6단계, 보안 기술·한계·기술 사양, 출시 예정 스토어 버튼, 소개 영상 자리)
- website/privacy.html: 개인정보처리방침 (수집 없음, 권한 설명, 파기, 웹사이트 접속 기록)
- website/assets/fonts, tools/fetch_fonts.py: 글꼴 직접 호스팅으로 웹사이트 외부 요청 0건
- docs/PRD.md: PrivateVault PRD v1.0 원문 저장
- docs/REVIEW.md: 설계 가능성 및 보안 검토 (Owner 추가 요구사항 R1~R5, 위험 G1~G10, 미해결 8개 항목 권고)
- SPEC.md: 수락 기준 초안 v0.1
- STATUS.md, NEXT_STEPS.md, CHANGELOG.md
### Changed
- SPEC.md: MVP 범위를 사진 + 동영상으로 확정, 동영상 수락 기준 AC-44~46 추가
- docs/REVIEW.md: 6장 재검증 (공식 문서·포렌식 자료) 및 최고 수준 설계 권고 S1~S10 추가, SPEC AC-14·AC-15 추가, PIN 최소 10자리 권고
- SPEC.md: PIN 최소 4자리로 확정 (Owner 결정), 10자리 권장·강도 표시 AC-03a 추가
