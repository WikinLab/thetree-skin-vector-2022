# thetree-skin-vector-2022

the tree용 MediaWiki Vector 2022 스킨입니다.

> [!NOTE]
> Vector 2022는 데스크톱 환경용입니다. 모바일 환경에서는 [Skin Composer](https://github.com/WikinLab/thetree-skin-composer)로 Minerva 같은 모바일 스킨과 결합한 구성을 권장합니다.

## 주요 기능

- MediaWiki Vector 2022 디자인
- 데스크톱 화면과 반응형 레이아웃
- 글 크기, 본문 너비와 밝기 설정
- 접을 수 있는 목차와 고정 헤더
- the tree의 문서 도구, 검색과 사용자 메뉴
- 로그인 사용자의 문서 주시 및 해제
- Skin Composer의 데스크톱 슬롯 지원

## 요구 사항

- the tree 관리자 계정의 `developer` 권한
- Node.js 20.19.1 이상과 npm 10.8.2 이상
- Git이 설치되어 있고 GitHub에 접속할 수 있는 서버
- the tree 설치 서버의 명령줄 접근 권한

## 설치

1. the tree에서 **관리자 → 개발자 설정 → 스킨**으로 이동합니다.
2. 이름에 `vector-2022`, URL에 `https://github.com/WikinLab/thetree-skin-vector-2022`를 입력하고 **추가**를 누릅니다.
3. the tree 설치 디렉터리에서 다음 명령을 실행합니다.

   ```sh
   cd frontend/skins/vector-2022
   npm run bootstrap
   ```

4. 관리자 화면의 `vector-2022` 항목에서 **빌드**를 누릅니다.
5. 관리자 설정에서 기본 스킨을 `vector-2022`로 지정하거나 사용자 설정에서 `vector-2022`를 선택합니다.

모바일 환경을 함께 제공하려면 [`thetree-skin-composer`](https://github.com/WikinLab/thetree-skin-composer)로 Vector 2022와 Minerva 같은 모바일 스킨을 결합합니다.

## 설정

| 설정 키 | 설명 | 기본값 |
| --- | --- | --- |
| `skin.vector-2022.logo_icon` | 헤더 아이콘 이미지 URL | `wiki.logo_url` |
| `skin.vector-2022.logo_wordmark` | 워드마크 이미지 URL | 없음 |
| `skin.vector-2022.logo_wordmark_width` | 워드마크 원본 너비(px) | 없음 |
| `skin.vector-2022.logo_wordmark_height` | 워드마크 원본 높이(px) | 없음 |
| `skin.vector-2022.logo_tagline` | 태그라인 이미지 URL | 없음 |
| `skin.vector-2022.logo_tagline_width` | 태그라인 원본 너비(px) | 없음 |
| `skin.vector-2022.logo_tagline_height` | 태그라인 원본 높이(px) | 없음 |
| `skin.vector-2022.footer_html` | 푸터에 표시할 HTML | `wiki.footer_text` |
| `skin.vector-2022.main_menu_pinned` | 주 메뉴를 사이드바에 고정 | `true` |
| `skin.vector-2022.page_tools_pinned` | 문서 도구를 사이드바에 고정 | `true` |
| `skin.vector-2022.toc_pinned` | 목차를 사이드바에 고정 | `true` |
| `skin.vector-2022.appearance_pinned` | 보이기 설정을 사이드바에 고정 | `true` |
| `skin.vector-2022.limited_width` | 본문 너비 제한 | `true` |
| `skin.vector-2022.font_size` | 글 크기 (`0`, `1`, `2`) | `0` |

## 업데이트

1. **관리자 → 개발자 설정 → 스킨 → vector-2022**에서 **업데이트**를 누릅니다.
2. `frontend/skins/vector-2022`에서 `npm run bootstrap`을 실행합니다.
3. 같은 화면에서 **빌드**를 누릅니다.

## 문제 해결

생성 파일이나 내려받은 원본 때문에 부트스트랩이 실패하면 다음 명령으로 다시 준비합니다.

```sh
npm run bootstrap -- --clean
```

Windows에서 `Filename too long` 오류가 나오면 관리자 권한 터미널에서 Git의 긴 경로 지원을 활성화한 뒤 다시 실행합니다.

```sh
git config --system core.longpaths true
```

## 면책

이 스킨을 사용하면서 발생하는 문제에 대해서는 책임지지 않습니다.

## 개발 도구

이 프로젝트의 개발에는 OpenAI ChatGPT가 사용되었습니다.

## 버전과 라이선스

현재 버전은 `package.json`에서 확인할 수 있습니다.

이 프로젝트는 GPL-2.0-or-later로 배포됩니다. 원본과 제3자 저작권 고지는 `NOTICE`와 `THIRD_PARTY_NOTICES.md`에서 확인할 수 있습니다.
