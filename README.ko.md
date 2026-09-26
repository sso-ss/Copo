# CoPo

[English](README.md) | [한국어](README.ko.md)

**CoPo = Connection Point (연결점)**

*“도구와 모델이 만나는 연결점.”*

<img src="docs/assets/companion-animation.gif" alt="쉬고, 타이핑하고, 귀를 긁고, 기뻐하는 CoPo 고양이 마스코트 애니메이션" width="120">

CoPo는 하나의 로컬 게이트웨이를 통해 AI 도구와 모델을 연결합니다.
현재는 GitHub Copilot 계정으로 Claude Code, Claude Desktop, 로컬 Codex
세션을 연결하고, 도구와 모델, 계정, 사용량을 한곳에서 관리할 수 있습니다.

이 앱의 이전 이름은 **ModelRelay**였습니다. Copilot을 넘어 더 많은 도구와
모델 제공자를 연결하는 앱으로 확장할 수 있도록, 연결점이라는 의미를 담아
**CoPo**로 이름을 바꿨습니다. 현재 지원하는 모델 제공자는 GitHub Copilot이며,
앞으로 더 다양한 제공자를 지원하는 방향으로 발전시키고자 합니다.

**고양이는 CoPo의 마스코트**이자 데스크톱에서 함께하는 동반자입니다.
작업하는 동안 곁에 머물고, 작업이 끝나면 축하하며, 확인이 필요한 상황에는
반응으로 알려줍니다. 따뜻한 중성 색상과 둥근 컨트롤, 취향에 맞게 꾸밀 수 있는
고양이가 데스크톱에 자연스럽게 어우러집니다.

**개발 상태:** 프리 알파, 버전 0.1.0. Claude Code와 Codex의 로컬 작업 모니터링은
구현되어 있으며, 패키징된 앱의 전체 실사용 검증은 진행 중입니다.
현재 지원 범위와 제약은 [구현 노트](docs/dev/companion-implementation.md)를 참고하세요.

## 주요 기능

- **곁에서 작업 상태를 알려줍니다.** 데스크톱 고양이가 작업 중, 대기, 완료,
  중단 상태에 반응합니다. 클릭하면 연결 패널을 열 수 있고, 드래그해서 화면의
  편한 위치로 옮길 수 있습니다.
- **도구를 연결합니다.** Settings → Apps에서 지원하는 앱의 설치 여부를 확인하고,
  Configure로 연결하거나 Disconnect로 해제할 수 있습니다. 설치되지 않은 앱은
  설치 방법을 안내합니다.
- **설정을 한곳에서 관리합니다.** 여러 설정 파일을 오갈 필요 없이 GitHub 계정,
  모델 라우팅, API 키를 관리할 수 있습니다.
- **사용량을 보여줍니다.** Settings → Usage와 Dashboard에서 Copilot 사용 한도와
  기록된 토큰 사용량을 확인할 수 있습니다.
- **취향에 맞게 조정합니다.** 시스템 설정 따르기, 밝은 모드, 어두운 모드 중에서
  선택하고, Personalization에서 고양이의 크기를 조절하거나 자세와 동작을
  미리 볼 수 있습니다.
- **게이트웨이로 활용할 수 있습니다.** 다른 호환 도구도 CoPo API 키를 사용해
  Anthropic 및 OpenAI 호환 엔드포인트에 연결할 수 있습니다.

CoPo는 로컬에서 실행되며, 모델 요청은 GitHub Copilot으로 전송됩니다.
Copilot과 사용하려는 모델에 접근할 수 있는 GitHub 계정이 필요합니다.

## 시작하기

최신 CoPo 데스크톱 빌드를 기준으로 안내합니다.
앱에서 메뉴와 버튼을 쉽게 찾을 수 있도록 아래에는 영문 UI 이름을 사용했습니다.

1. **CoPo**를 실행하고 GitHub 계정으로 로그인합니다.
2. **Settings → Apps**에서 연결할 도구 옆의 **Configure**를 선택합니다.
3. 도구가 설치되어 있지 않다면 안내에 따라 설치한 뒤 **Check again**을 선택합니다.
   Claude Code는 복사할 수 있는 설치 명령어를, Claude Desktop은 공식 다운로드
   페이지 링크를 제공합니다.
4. 설정한 도구를 재시작하고 새 세션을 시작합니다. Codex Desktop에서는 새 로컬
   채팅을 만들어야 CoPo 제공자 설정이 적용됩니다.
5. 요청을 보내면 CoPo의 연결 패널에 도구의 활동이 표시됩니다.

**Configured**는 CoPo가 해당 도구의 설정을 저장했다는 뜻입니다.
실제 요청 활동이 표시되면 연결이 작동하는 것을 확인할 수 있습니다.
도구가 CoPo를 통해 요청을 보내지 않도록 하려면 **Disconnect**를 선택해
CoPo가 관리하는 설정을 제거하세요.

도구가 게이트웨이를 사용하는 동안에는 CoPo를 실행해 두세요.
새 빌드를 설치한 뒤에는 CoPo를 종료하고 다시 실행해야 업데이트가 적용됩니다.

### 지원 도구

| 도구 | 연결 방법 | 고양이에 반영되는 활동 |
|---|---|---|
| Claude Code | Settings → Apps에서 Configure 선택 | 요청 및 로컬 작업의 시작, 대기, 완료, 취소, 실패 |
| Claude Desktop / Cowork | 타사 추론 프로필 설정 | 요청 활동. 전체 작업의 완료 감지는 아직 지원하지 않음 |
| Codex CLI 및 Desktop | Settings → Apps에서 공유 설정 사용 | CoPo 제공자를 사용하는 세션의 요청 및 로컬 작업 상태 변화 |
| 기타 호환 API 클라이언트 | API 키 생성 후 클라이언트의 기본 URL 설정 | 해당 키로 식별되는 요청 활동 |
| Copilot CLI | 지원 예정 | 아직 지원하지 않음 |

Codex CLI와 Desktop은 연결과 API 키를 공유합니다. 원격 및 클라우드 Codex 세션은
로컬 작업 모니터링 대상에 포함되지 않습니다. 로컬 작업 감지는 클라이언트의
기록 형식에 의존하며, 완료 기록이 없거나 형식을 알 수 없으면 축하 동작을
표시하지 않습니다.

## 고양이와 함께하기

| 자세 | 표시되는 상황 |
|---|---|
| 작업 중 | 요청이나 지원되는 작업이 실행 중일 때. 같은 작업 안에서 요청 사이에 생기는 대기 시간도 포함 |
| 쉬는 중 | 연결된 도구가 준비되었거나, 지원되는 작업이 사용자 입력을 기다릴 때 |
| 기쁨 | 지원되는 작업의 완료가 확인되거나, 첫 요청 성공으로 연결이 검증되었을 때 |
| 놀람 | 작업이 실패하거나 취소되었을 때, 요청이 중단되었을 때, 게이트웨이 연결에 문제가 생겼을 때 |
| 하트 | 고양이 위에 마우스 포인터를 올렸을 때 |
| 잠자기 | 준비된 도구가 없거나, 로그인이 필요하거나, 활동 정보를 확인할 수 없을 때 |

기쁨 반응은 **10초**, 놀람 반응은 일반적으로 **4초** 동안 유지됩니다.
진행 중인 작업과 게이트웨이 상태가 이러한 반응보다 우선합니다.
앱을 다시 열어도 이전 작업의 완료를 다시 축하하지 않습니다.

**Settings → Personalization → Try motions**에서 열 가지 자세와 동작을
하나씩 확인하거나, **Play all**로 모두 재생하거나, 재생을 일시 정지할 수 있습니다.
미리 보기는 실제 작업 활동과 별개로 동작합니다. Reduce Motion을 켜면
같은 자세를 정지 이미지로 볼 수 있습니다.

## 소스에서 빌드하기

아래 데스크톱 빌드 안내는 macOS 기준입니다.
[`.bun-version`](.bun-version)에 지정된 Bun 버전과 Rust 도구 모음,
Xcode Command Line Tools를 설치하세요.

저장소를 내려받은 폴더에서 다음 명령어를 실행합니다.

```sh
bun install
bun run app:setup
bun run app:dev
```

macOS 앱과 디스크 이미지를 빌드하려면 다음 명령어를 실행합니다.

```sh
bun run app:build
```

Tauri는 앱과 디스크 이미지를 `shell/src-tauri/target/release/bundle/`에 생성합니다.
빌드에는 게이트웨이, UI, 글꼴, 고양이 이미지가 함께 포함됩니다.

빠른 UI 개발 방법은 [개발 명령어](docs/commands.md)를,
패키징과 배포 절차는 [릴리스 가이드](docs/release-runbook.md)를 참고하세요.
원본 프로젝트의 Homebrew 포뮬러인 `stuffbucket/tap/maximal`은 Maximal을 설치하며,
CoPo 설치용이 아닙니다.

### 게이트웨이만 실행하기

데스크톱 고양이 없이 게이트웨이만 사용할 수도 있습니다.
`bun install`을 실행한 뒤, 저장소 폴더에서 한 번 인증하고 게이트웨이를 시작하세요.

```sh
bun run ./src/main.ts auth
bun run ./src/main.ts start
```

기본 포트는 **4141**입니다.
[Settings](http://127.0.0.1:4141/ui/settings/)에서 도구를 설정하거나,
[Dashboard](http://127.0.0.1:4141/ui/dashboard/)에서 사용량을 확인할 수 있습니다.

클라이언트를 직접 설정한다면 Anthropic 기본 URL은 `http://127.0.0.1:4141`,
OpenAI 기본 URL은 `http://127.0.0.1:4141/v1`을 사용하세요.
**Settings → API keys**에서 활성화된 키와 지원되는 모델을 함께 지정해야 합니다.

CLI를 설치하면 `copo` 명령어를 사용할 수 있습니다.
호환성을 위해 `maximal` 별칭도 유지됩니다. 자주 사용하는 명령어는 다음과 같습니다.

```sh
copo app list
copo app codex --enable
copo app codex --disable
copo check-usage
copo debug
copo start --help
```

소스에서 직접 실행할 때는 `copo` 대신 `bun run ./src/main.ts`를 사용하세요.

## 설정과 로컬 데이터

대부분의 일상적인 설정은 Settings에서 변경할 수 있습니다.
명령줄에서 사용할 수 있는 주요 옵션은 다음과 같습니다.

| 설정 | 옵션 |
|---|---|
| 게이트웨이 포트 | `start --port 4141` |
| Copilot 계정 유형 | `start --account-type individual`, `business` 또는 `enterprise` |
| GitHub Enterprise 호스트 | `COPILOT_API_ENTERPRISE_URL` |
| 사용자 지정 데이터 폴더 | `COPILOT_API_HOME` 또는 `--api-home` |
| 호스팅 웹 검색 기능 사용 시 | `OLLAMA_API_KEY` |
| 문제 해결용 출력 | `start --verbose` 및 `debug` |

CoPo는 설정, 계정 인증 정보, 사용량 데이터, 로그를 macOS와 Linux에서는
`~/.local/share/copo`에, Windows에서는 `%APPDATA%\copo`에 저장합니다.
제공자의 비밀 키는 데이터 폴더 안의 `secrets/` 폴더에 저장할 수 있으며,
환경 변수 값이 우선 적용됩니다. `copo debug`는 비밀 값을 출력하지 않고
실제로 적용되는 설정과 비밀 키를 읽어 온 위치를 보여줍니다.

업그레이드 시 CoPo 데이터 폴더가 없다면 기존 `maximal` 데이터 폴더를
이전할 수 있습니다. 먼저 이전 앱을 종료하세요. 기존 저장소를 병합하거나
덮어쓰지 않으며, 사용자가 명시적으로 지정한 데이터 폴더는 이전하지 않습니다.
자세한 내용은 [저장소 이전](docs/dev/storage-migration.md)을 참고하세요.

작업 모니터링은 로컬 클라이언트의 작업 상태 기록을 읽습니다.
활동 이벤트에는 프롬프트나 응답이 아닌 상태 메타데이터가 포함되며,
새로운 대화 기록 저장소를 만들지 않습니다. 이는 게이트웨이의 요청 로깅과는
별개입니다. 로그와 진단에 대한 설명은 [아키텍처 가이드](docs/architecture.md)를
참고하세요.

게이트웨이는 Anthropic의 서버 측 웹 도구를 Copilot이 처리할 수 있는
도구 호출로 변환하기도 합니다. 호스팅 검색을 사용하려면 선택 사항인
Ollama API 키가 필요합니다. 키가 없으면 검색을 사용할 수 없다고 표시하며,
웹 콘텐츠 가져오기는 로컬에서 실행됩니다.
자세한 내용은 [웹 도구 명세](docs/spec/archive/web-tools.md)를 참고하세요.

## 개발과 문서

| 경로 | 내용 |
|---|---|
| `src/` | 게이트웨이, 인증, 앱 연동, 작업 모니터링 |
| `shell/src/` 및 `shell/ui/` | Settings, Dashboard, 고양이 UI |
| `shell/src-tauri/` | 네이티브 데스크톱 셸과 게이트웨이 실행 관리 |
| `tests/` | 자동화 테스트 |
| `docs/` | 아키텍처, 설정 참고 자료, 디자인 가이드, 구현 노트 |
| `scripts/` | 개발, 빌드, 릴리스 보조 도구 |

변경하기 전에 [AGENTS.md](AGENTS.md)와 [CLAUDE.md](CLAUDE.md)를 읽어 주세요.
모든 인터페이스는 공식 [CoPo 디자인 스타일](DESIGN.md)을 따릅니다.
고양이, 메뉴, Settings, Dashboard 전반에 따뜻한 중성 색상, 둥근 모서리,
명확한 타이포그래피, 일관된 컨트롤을 적용합니다.

- [개발 명령어와 검증](docs/commands.md)
- [아키텍처](docs/architecture.md)
- [고양이 기능 구현과 알려진 제약](docs/dev/companion-implementation.md)
- [Codex 연동](docs/dev/codex-integration.md)
- [Claude Desktop / Cowork 설정](docs/admin/claude-desktop-mdm.md)
- [릴리스 절차](docs/release-runbook.md)
- [문제 제보](https://github.com/sso-ss/ModelRelay/issues)

## 크레딧과 라이선스

CoPo는 [Maximal](https://github.com/stuffbucket/maximal)을 포크한 프로젝트로,
Maximal의 GitHub Copilot 게이트웨이와 클라이언트 연동을 기반으로 합니다.
일부 내부 프로토콜 이름, 사이드카 파일 이름, `com.sso-ss.modelrelay` 번들 식별자는
호환성을 위해 유지됩니다.

[MIT 라이선스](LICENSE)로 배포됩니다. 포함된 의존성과 이미지의 출처 및 저작권
표시는 [THIRD-PARTY-LICENSE](THIRD-PARTY-LICENSE)를 참고하세요.
