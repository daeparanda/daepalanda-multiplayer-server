import { DurableObject } from "cloudflare:workers";

export interface Env { ROOMS: DurableObjectNamespace<GameRoom> }

type Player = { id: string; name: string; x: number; z: number; angle: number; hp: number; alive: boolean; respawnAt: number };
type ClientMessage =
  | { type: "join"; name: string }
  | { type: "move"; x: number; z: number; angle: number }
  | { type: "hit"; target: string; damage: number }
  | { type: "ping"; sentAt: number };

const SITE_ORIGIN = "https://daepalanda-skill-fps.daeparanda.chatgpt.site";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json", "access-control-allow-origin": SITE_ORIGIN },
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": SITE_ORIGIN, "access-control-allow-headers": "content-type" } });
    if (url.pathname === "/health") return json({ ok: true, service: "daepalanda-multiplayer" });
    const match = url.pathname.match(/^\/room\/([A-Z0-9]{4,8})$/i);
    if (!match) return json({ error: "room_not_found" }, 404);
    const roomCode = match[1].toUpperCase();
    return env.ROOMS.getByName(roomCode).fetch(request);
  },
};

export class GameRoom extends DurableObject<Env> {
  private players = new Map<string, Player>();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "websocket_required" }, 426);
    if (this.ctx.getWebSockets().length >= 4) return json({ error: "room_full" }, 409);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id });
    server.send(JSON.stringify({ type: "welcome", id, players: [...this.players.values()], mapSize: 36, respawnSeconds: 30 }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const { id } = socket.deserializeAttachment() as { id: string };
    let message: ClientMessage;
    try { message = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); }
    catch { return; }

    if (message.type === "join") {
      const player: Player = { id, name: String(message.name || "PLAYER").slice(0, 16), x: 0, z: 0, angle: 0, hp: 100, alive: true, respawnAt: 0 };
      this.players.set(id, player);
      this.broadcast({ type: "playerJoined", player });
      return;
    }
    const player = this.players.get(id);
    if (!player) return;
    if (message.type === "move" && player.alive) {
      const limit = 17.5;
      player.x = Math.max(-limit, Math.min(limit, Number(message.x) || 0));
      player.z = Math.max(-limit, Math.min(limit, Number(message.z) || 0));
      player.angle = Number(message.angle) || 0;
      this.broadcast({ type: "playerMoved", player }, socket);
    } else if (message.type === "hit") {
      const target = this.players.get(message.target);
      if (!target?.alive) return;
      target.hp = Math.max(0, target.hp - Math.max(0, Math.min(100, Number(message.damage) || 0)));
      if (target.hp === 0) { target.alive = false; target.respawnAt = Date.now() + 30_000; }
      this.broadcast({ type: "playerHealth", player: target });
    } else if (message.type === "ping") socket.send(JSON.stringify({ type: "pong", sentAt: message.sentAt }));
  }

  async webSocketClose(socket: WebSocket): Promise<void> { this.remove(socket); }
  async webSocketError(socket: WebSocket): Promise<void> { this.remove(socket); }

  private remove(socket: WebSocket) {
    const attachment = socket.deserializeAttachment() as { id?: string } | null;
    if (!attachment?.id) return;
    this.players.delete(attachment.id);
    this.broadcast({ type: "playerLeft", id: attachment.id });
  }

  private broadcast(value: unknown, except?: WebSocket) {
    const data = JSON.stringify(value);
    for (const socket of this.ctx.getWebSockets()) if (socket !== except) try { socket.send(data); } catch { /* disconnected */ }
  }
}
