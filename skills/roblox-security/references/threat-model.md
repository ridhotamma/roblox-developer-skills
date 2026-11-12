# Threat model

## The trust boundary

Roblox runs every game with FilteringEnabled (it can't be turned off): changes a client makes to its own copy of the world do not replicate to the server, with specific exceptions. Exploit tools run arbitrary Luau inside the player's client with elevated access to that client.

### What an exploiter can do
- **Read** every replicated script and module: LocalScripts, and ModuleScripts in ReplicatedStorage, ReplicatedFirst, StarterGui, StarterPlayer, StarterPack and Workspace. Decompilers recover readable code. Anything in those places is public: logic, config, remote names, thresholds, comments.
- **Run code** in their client, including hooking or replacing the game's LocalScripts and modules (so client-side checks can be disabled or faked).
- **Fire every RemoteEvent and invoke every RemoteFunction** they can see, with any arguments, at any rate. Only the first argument (the `Player`) is filled in by Roblox and can be trusted.
- **Respond to `InvokeClient`** with anything, or never respond.
- **Control their character's physics**: the client owns its character's assemblies, so position, velocity, flying, noclipping, teleporting and speed replicate to the server. Same for any unanchored part whose network ownership the server gave them (automatically, by proximity, unless set otherwise).
- **Trigger client-detected interactions** at any range and frequency: `Touched` involving their character, `ProximityPrompt` triggers, `ClickDetector` clicks, tool activation.
- **Change replicated properties of their own character** in ways that replicate (animations played through the Animator, some Humanoid state, moving or removing their own character's parts).
- **Change anything locally** (delete walls, see through objects, read other players' positions and replicated data, auto-aim using replicated positions). These don't affect the server but can give an advantage (ESP, aimbots, auto-farming by firing remotes in a loop).

### What an exploiter cannot do
- Read or run code in ServerScriptService or ServerStorage (those never replicate).
- Change server-side values directly: data tables in server scripts, Attributes/Values set by the server, other players' characters, anchored parts the server owns.
- Fire remotes as another player, or forge the `player` argument.
- Access DataStores, MessagingService, HttpService or secrets.

### The consequence
Anything the server does in response to a client message, or based on a client-owned physics value (character position), is attack surface. Everything else is safe by default.

## Trust table

| Input | Trust | Server-side defence |
|---|---|---|
| `player` argument of OnServerEvent / OnServerInvoke | trusted | — |
| Any other remote argument | untrusted | type + range + allow-list + ownership checks |
| Remote call rate and order | untrusted | rate limit, cooldown on server clock, state machine |
| Character position / velocity | untrusted but needed | movement sanity checks (anticheat.md), distance checks for interactions |
| Touched events on their character | untrusted | distance check from character to part; debounce; server state |
| ProximityPrompt.Triggered / ClickDetector | untrusted | re-check distance, cooldown and state on the server |
| Tool.Activated replicated from client | untrusted | treat as "wants to use", validate cooldown/range |
| Animations on their character | untrusted | never derive gameplay (hitboxes, damage timing) from replicated animation state alone |
| `Player:GetJoinData()` / teleport data | untrusted (client can forge) | only pass non-sensitive hints; real state via DataStores/MemoryStores |
| Camera / mouse data sent by client (aim direction, mouse hit position) | untrusted | clamp, check against character position and line of sight |
| Text typed by players | untrusted | `TextService` filtering before showing to others; length limits |
| Data in ProfileStore / DataStores written by server | trusted | session locking prevents cross-server races |
| Device trust level (Roblox's Device Trust API) | a signal, not proof | optional extra restrictions (e.g. trading) for low-trust devices |

## Network ownership

- The server can keep ownership of important unanchored parts with `part:SetNetworkOwner(nil)` (moving platforms, NPCs, projectiles, physics puzzles). This costs server physics time but stops clients from moving them.
- Characters must be client-owned for responsive movement. That's why movement exploits exist and why the server must sanity-check positions, unless the game uses Roblox's server authority model, where the server simulates and clients only send input.
- Vehicles: the driver usually gets ownership for smooth handling; check speed against the vehicle's maximum.

## Roblox's own protections

Roblox's client anti-tamper (Hyperion on desktop) and moderation remove a lot of casual exploiting, but exploits still exist on some platforms and new bypasses appear. Design as if every client could be hostile.

## Severity guide

| Severity | Examples |
|---|---|
| Critical | Free currency or items, duplication, data wipe of other players, server-side code execution (backdoor), purchase grants without payment |
| High | Killing/griefing other players at will, ruining rounds, crashing servers (remote spam, giant payloads), leaking secrets |
| Medium | Movement cheats (speed, fly, noclip) in competitive modes, auto-farming |
| Low | Local-only cheats (ESP, seeing through walls), cosmetic oddities |

Fix in that order.
