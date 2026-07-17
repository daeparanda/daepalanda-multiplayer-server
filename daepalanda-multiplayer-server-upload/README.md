# 대파란다 스킬 FPS 멀티플레이 서버

Cloudflare Durable Objects와 WebSocket을 사용하는 2~4인 협동 서버입니다.

## 배포

Cloudflare Workers의 **Import a repository**에서 이 저장소를 선택한 뒤 배포합니다.

- Build command: 비워 둠
- Deploy command: `npx wrangler deploy`
- Version command: `npx wrangler versions upload`

배포가 끝나면 생성된 `workers.dev` 주소를 게임 클라이언트에 연결합니다.
