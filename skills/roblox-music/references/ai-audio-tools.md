# Generating music and sound effects with AI tools

## Contents
1. When to generate, when to compose
2. Free tools (local, no per-use cost)
3. Paid tools (cloud)
4. Connecting a tool over MCP
5. Prompting sound effects
6. Prompting music
7. From generated audio to Roblox: `fit`
8. Stems, stingers and the adaptive kit
9. Licences, moderation and provenance
10. Troubleshooting

`scripts/generate.cjs` drives all of this: `status` shows which tools are ready, `prompt` turns a mood into a prompt, `music` and `sfx` generate and clean up in one step, and `fit` prepares a file from any tool.

---

## 1. When to generate, when to compose

| Need | Best source |
|---|---|
| Adaptive layered music (intensity stems that must line up) | `compose.cjs render`. Every stem shares one grid by construction. AI tools give one stereo track. |
| A linear track: menu, credits, trailer, lobby, radio station | AI music (`generate.cjs music`), cut to a seamless loop with `fit`. |
| A full-intensity combat or chase loop that sounds like real instruments | AI music on the mood's tempo, fitted as a one-stem cue. Use it as the top state, or split it into stems (§8). |
| Sound effects: doors, footsteps, impacts, UI, creatures, ambience beds | AI SFX (`generate.cjs sfx`) or a CC0 library. The synth engine doesn't make SFX. |
| Stingers (jumpscare, victory, level up) | Either works. The engine's are in key with the cue. AI ones sound more real; fit them with `--oneshot`. |
| Voice lines and barks | Mirli `soundbox.speak` or ElevenLabs TTS. Voice audio gets stricter moderation. |

AI output is never on the kit's grid by itself. Always ask for the mood's exact BPM, then `fit` (§7).

## 2. Free tools (local, no per-use cost)

| Tool | Makes | Licence of the output | Notes |
|---|---|---|---|
| **Mirli** (formerly Soundbox), MIT app | SFX, music, speech, stem separation, a small mixer. **24 MCP tools** at `http://127.0.0.1:17494/mcp` | Depends on the model (below) | Windows / macOS desktop app. It runs open-weight models on your GPU through audio.cpp (no Python). The app must be running for the MCP endpoint to answer. Library in `~/.mirli/sounds`. |
| ↳ `audiocpp-stable-audio-3-sfx` (Stable Audio 3.0 Small SFX, ~1.6 GB) | SFX, foley, ambience, up to 120 s, 44.1 kHz stereo | Stability AI Community License: free commercial use under US$1M annual revenue, a paid licence above that | Responds to material, action and space. Takes about 5-10 s per take on an 8 GB RTX card. |
| ↳ `audiocpp-ace-step` (ACE-Step 1.5 Turbo, ~5.8 GB) | Instrumental or vocal music, up to 60 s, 48 kHz | **MIT**: unrestricted commercial use | Comma-separated tag prompts. Supports `edit: extend / cover / repaint` of a library sound. Expect minutes per take. |
| ↳ `audiocpp-stable-audio-3-small-music`, `audiocpp-minimax-music3` | Music | Stability Community / MiniMax community (conditional) | Optional downloads from the app. |
| ACE-Step 1.5 on its own (GitHub, Hugging Face) | Music, stems | MIT | Python / ComfyUI. Several MCP wrappers exist. |
| Stable Audio Open (Hugging Face, diffusers) | SFX, short loops | Stability Community | The older open model, up to about 47 s. |
| Meta AudioCraft (MusicGen, AudioGen) | Music, SFX | Code MIT, **weights CC-BY-NC: not for a commercial game** | Fine for prototypes and references only. |
| 16bits-audio-mcp | Chiptune BGM, SFX, jingles (FM synthesis) | Your own output | A tiny MCP server with no models. Good for obby and retro games, useless for realism. |
| **Freesound** (API key, MCP servers exist) | Recorded SFX library (search, not generation) | Per sound: CC0, CC-BY (credit it), CC-BY-NC (not for a commercial game) | Filter to CC0 to skip attribution. Real recordings are still the best source for footsteps and foley. |
| Roblox Creator Store audio | Licensed music and SFX | Free to use **inside Roblox experiences** only | Search in Studio's Toolbox. It costs no upload quota. |

Setting up Mirli, the zero-cost route:
1. Download the Windows or macOS build from [github.com/HamSanders/soundbox/releases](https://github.com/HamSanders/soundbox/releases) (about 30 MB) and run it. It serves the UI and MCP at `127.0.0.1:17494`.
2. In the app's model manager, install `Stable Audio 3 SFX` and `ACE-Step 1.5 Turbo`. Install a separation model too if you want stems (§8).
3. Install ffmpeg for MP3/OGG reading and `--ogg` output: `winget install ffmpeg`, or `brew install ffmpeg`.
4. `node scripts/generate.cjs status` should list both models as installed.

GPU notes: 8 GB of VRAM runs both models one at a time, and generation is serialized. A CPU alone works but is very slow for music.

## 3. Paid tools (cloud)

Prices and limits change. Check the provider's page before quoting them to a user.

| Tool | Makes | How to call it | Rights |
|---|---|---|---|
| **ElevenLabs** | SFX (v2: 0.5-30 s, `loop: true` for seamless loops, several takes), music (3 s - 10 min, `force_instrumental`), TTS | REST with `ELEVENLABS_API_KEY` (`generate.cjs --provider elevenlabs`). Or the hosted **ElevenCreative MCP** at `https://api.elevenlabs.io/v1/mcp-creative` (OAuth, no key). Its file links expire after a few hours, so download them right away. | Commercial use needs a paid plan. Free-plan output is non-commercial with attribution. |
| **Suno** | Full songs, instrumentals, extend, stems, MIDI | Official MCP at `https://api.suno.com/mcp` (uses your plan's credits) | Commercial rights only on paid plans. Free-plan songs are non-commercial. |
| **ForgeGUI** | Game music (3-600 s, `loopable` flag, mood) and SFX (0.5-30 s, category, up to 5 takes) | Its MCP tools `generation_music`, `generation_sound_effect`, `generation_status`. They can **publish straight to Roblox** as an Audio asset (`delivery: {mode: "publish", platform: "roblox"}`). | Credit-based. If it says `insufficient_credits`, tell the user and stop. |
| Stability AI (Stable Audio 2.5 / 3.0) | Music and SFX, audio-to-audio, inpainting | Stability's API, or hosts like fal and Replicate | Per the provider's terms |
| SFX Engine, others | SFX, background music | Web app or MCP | Per plan |

Note on ForgeGUI publishing: it uploads the MP3 exactly as generated. That is fine for one-shot SFX and linear tracks. For a music loop, use `delivery: direct`, run `fit`, and upload the fitted WAV yourself. ForgeGUI's `loopable` flag only asks for loop-friendly music and does not check the seam.

## 4. Connecting a tool over MCP

Once an MCP server is connected, the agent can call it directly. Then it runs `generate.cjs fit` on the file path or download.

```bash
# Claude Code
claude mcp add --transport http soundbox http://127.0.0.1:17494/mcp      # Mirli (free)
claude mcp add --transport http elevencreative https://api.elevenlabs.io/v1/mcp-creative
claude mcp add --transport http suno https://api.suno.com/mcp
```

```jsonc
// opencode.json / .mcp.json style
{ "mcp": { "soundbox": { "type": "remote", "url": "http://127.0.0.1:17494/mcp" } } }
```

Mirli tools worth knowing:
- `soundbox.generate {prompt, model, duration_s, variations ≤ 4, seed, negative_prompt, lyrics, source_sound_id + edit}` blocks until the WAV is written. Each result has `path`, the file on disk. `url` is the app's route, not a file.
- `soundbox.list_models` gives licence and `commercial_use` per model. Check it before shipping.
- `soundbox.enhance_prompt {prompt, model, category}` rewrites an abstract prompt in the model's own style. It needs the app's local prompt assistant to be enabled.
- `soundbox.separate {sound_id, stems}` splits music into vocals, drums, bass and other. It needs a separation model installed.
- `soundbox.list_sounds` lets you reuse past generations before making new ones.

Without MCP, `generate.cjs` speaks the protocol itself: `--provider mirli` talks to `MIRLI_URL`, which defaults to `http://127.0.0.1:17494/mcp`.

## 5. Prompting sound effects

Describe the **source + material + action + order of events + space + distance**. Mood words alone ("scary sound", "cool whoosh") give noise.

| Weak | Strong |
|---|---|
| scary door | slow heavy wooden door creaking open in a damp stone basement, dry hinge groan, reverberant tail, close |
| coin sound | single small gold coin pickup, bright metallic ting with a short sparkle, dry, close, game UI |
| explosion | large fuel barrel explosion outdoors, sharp crack then deep rolling boom, debris falling on concrete, medium distance |
| monster | large creature low guttural growl rising to a wet snarl, inside a narrow metal vent, close |

Starting prompts by category (cut and change them):

| Category | Prompt | Duration |
|---|---|---|
| UI click | soft plastic button click, short and dry, game menu | 0.5 s |
| UI confirm | two-note bright marimba chime rising, clean, game UI confirm | 1 s |
| Purchase | cash register ding with coins dropping into a tray, cheerful, dry | 1.5 s |
| Level up | short magical shimmer rising into a bright bell chord, sparkly tail | 2 s |
| Footstep (wood) | single sneaker footstep on old wooden floorboards, slight creak, indoor | 0.5 s |
| Footstep (grass) | single footstep on dry grass and leaves, outdoor, close | 0.5 s |
| Sword swing | fast steel sword swing whoosh, airy, no impact | 0.6 s |
| Sword hit | steel sword striking a metal shield, sharp clang with ringing tail | 1 s |
| Punch | heavy punch impact on a body, deep thud, cloth rustle, close | 0.5 s |
| Pistol | 9mm pistol single shot outdoors, sharp crack, short echo off buildings | 1.5 s |
| Reload | pistol magazine ejected and a new one slapped in, slide racked, close | 1.5 s |
| Jump / land | character landing on a concrete floor from a jump, thud with a shoe scuff | 0.5 s |
| Pickup | small item picked up from a wooden table, light knock and cloth | 0.5 s |
| Door slam | wooden door slammed shut in a hallway, heavy bang, rattling frame | 1.5 s |
| Jumpscare | sudden violent orchestral string screech with a metallic hit, very loud, short tail | 2 s |
| Ambience (forest night) | night forest ambience, crickets, distant owl, light wind in leaves, constant | 20 s, `--loop` |
| Ambience (facility) | empty industrial facility room tone, low ventilation hum, distant metal creaks, constant | 20 s, `--loop` |
| Rain | steady rain on a tin roof, constant, no thunder | 20 s, `--loop` |

Tips:
- **Takes, not retries.** Ask for 3-4 variations (`--takes 4`) and keep 2-3. In game, pick one at random and vary `PlaybackSpeed` by ±5%.
- **Duration:** ask for a little more than you need. `fit --oneshot` trims the silence.
- **One event per sound.** "Door opens then slams" gives timing you can't control. Make two sounds.
- **Loops:** say "constant" and leave out events (thunder, a bird call) that would repeat noticeably. Use ElevenLabs `loop: true`, or `--loop` here, which crossfades the end into the start.
- **Positional SFX:** `--mono` for sounds played from a part in the world (an AudioEmitter or a Sound in a Part). Stereo for UI and ambience beds.
- **Negative prompt** (Mirli models that support it): `music, speech, voice, reverb` for a dry foley sound.

## 6. Prompting music

`node scripts/generate.cjs prompt <mood>` writes the prompt from a mood preset: its genres, vibe, instruments, drums, BPM and key. It also gives the duration to ask for and the `fit` command. Variants:
- **ACE-Step** (`--for ace-step`): comma tags. `horror game soundtrack, instrumental, low drone, solo cello, slow heartbeat pulse, 60 bpm, C# minor, steady tempo, loopable, no vocals`.
- **Stable Audio** (`--for stable-audio`): BPM and instruments first.
- **ElevenLabs / Suno** (`--for elevenlabs`): prose. Ask for a constant tempo from the first bar, the same density throughout, and no intro, fade or ending.

Rules:
- **Always give the exact BPM** from the mood, and the time signature. `fit` cuts on that grid, and the director switches on it.
- **Ask for two passes plus a bar** (`prompt` gives the number). Models drift and ramp up in the first bars. `fit` keeps a pass from the steady middle and uses the audio after it for the seam crossfade.
- **Instrumental.** Put `no vocals` in the prompt, set `force_instrumental` (ElevenLabs) or omit `lyrics` (ACE-Step). Vocals fight dialogue and draw moderation.
- **Never "in the style of <artist / song / game>".** Describe instruments, tempo and feel instead. Sound-alikes get copyright claims, and Roblox removes claimed audio.
- **Takes:** 2-4 per cue. Music models vary a lot between seeds. Keep the best, and record its seed (the `.source.json` does).
- **Short is fine.** An 8-bar loop at 120 BPM is 16 s. A loop that repeats for an hour is better under 30 s, with the kit's layering adding variety.

## 7. From generated audio to Roblox: `fit`

```
node scripts/generate.cjs fit take.wav --bpm 140 --bars 8 --name action_combat_ai      # music loop
node scripts/generate.cjs fit drums.wav bass.wav other.wav --bpm 140 --bars 8 --name boss   # stems, cut identically
node scripts/generate.cjs fit hit.wav --oneshot --mono                                   # SFX
node scripts/generate.cjs fit rain.wav --loop-sfx --xfade 0.8                            # ambience bed
```

Music (`fit <files> --bpm --bars`):
1. Reads WAV directly, or MP3/OGG/FLAC through ffmpeg. Rejects sample rates over 48 kHz.
2. Checks the tempo against `--bpm`. If the audio's beat is off by more than 2%, it says so: regenerate, or fit at the heard tempo and use that in the cue. `--bpm auto` guesses the tempo, but it is often off by half or double on sparse music, so give the BPM when you know it.
3. Finds the downbeat: the bar phase with the strongest onsets, at least one bar after the music starts (it skips intros). Override it with `--start <seconds>` after listening.
4. Cuts exactly `bars × beats × 60 / bpm` seconds, rounded once to samples. It crossfades the audio that follows the loop end into the loop start (equal power, `--xfade`, 0.12 s by default), so the seam continues as the original did, reverb tails included. If there is too little audio after the loop, it halves the bar count and says so.
5. Levels the mix to `--target` (-16 LUFS by default) with peaks under -1 dBFS. Stems share one gain and keep their balance.
6. Writes `<name>_<stem>.wav` (`_full` for one file), optional `.ogg` (`--ogg`), and `<name>.luau`, a MusicCues entry with Bpm, Bars and stems.

Check the result with `compose.cjs analyze <files> --bpm N --bars N`, then **listen to the loop point** repeat a few times. Analysis can't hear a musical seam that lands mid-phrase.

One-shots (`--oneshot`): trims leading and trailing silence below `--floor` (-50 dBFS), fades in over 3 ms and out over 30 ms, and peak-normalises to -1 dBFS. With `--target -18`, it levels by loudness instead. Set relative loudness in game with `Volume`.

Ambience (`--loop-sfx`): crossfades the end into the start (0.5 s by default) and levels to -20 LUFS (`--target`).

Loops and formats: keep loops in **WAV, FLAC or OGG**. Vorbis is gapless. **MP3 adds silence at both ends** and breaks the loop. That's why `fit` decodes an MP3 once and writes WAV.

## 8. Stems, stingers and the adaptive kit

A fitted AI track is a cue with one stem: `Stems = { { Name = "full", Min = 0, Full = 0 } }`. It still gets the director, bar-synced switches, intros, endings and stingers. Ways to get intensity layers from AI audio:

1. **Separate it.** Use Mirli `soundbox.separate` (with a separation model installed), Suno's stems, or a separator such as Demucs (MIT, local). Pass **all the stems to one `fit` call**, ordered bed → peak: `fit other.wav bass.wav drums.wav vocals.wav --bpm ...`. They are cut at the same sample and get one gain. `Min`/`Full` are spread bottom-up by default, so edit them in the `.luau` entry. Check that the bed alone ("other" or a pad) still sounds finished.
2. **Different cues per state, all on one tempo.** Generate `explore` and `combat` at the same BPM. The director then switches between them on the bar. You get horizontal re-sequencing without needing stems.
3. **Hybrid.** Keep the engine's stems for the low intensities (they layer perfectly) and use a fitted AI cue as the top state (boss, chase), with the same BPM and key so the switch feels natural.
4. **Regenerate the full mix.** `compose.cjs demo` or a render's full mix can feed an audio-to-audio model (ACE-Step `cover`, Stable Audio audio-to-audio, Suno cover). It restyles the music at the same length and tempo, so the grid survives. Then `fit` it.

Stingers, intros and endings from AI: generate short one-shots ("single orchestral hit with a choir swell, D minor, 2 seconds"), `fit --oneshot`, upload, and add them to the cue's `Stingers` / `Intro` / `Ending` with `Beats` set to their length in beats at the cue's tempo. Ask for the cue's key so they don't clash.

## 9. Licences, moderation and provenance

- **Check the model's licence before shipping.** Mirli reports it per model (`status`). ACE-Step is MIT. Stable Audio's community licence covers you under US$1M revenue. MiniMax is conditional. AudioCraft weights are non-commercial.
- **Paid plans for paid tools.** ElevenLabs and Suno free tiers are non-commercial. A Roblox game with game passes is commercial.
- **Roblox moderation** checks every upload. Instrumental music and SFX pass. Vocals, screams that sound real, and anything resembling a copyrighted song can be rejected or taken down later, sometimes with an account strike.
- **Provenance:** `music` and `sfx` write `<name>.source.json` next to the files: provider, model, licence, prompt, seed, date and raw takes. Keep it with the project. It is the answer to "where did this come from" in a dispute, and lets you regenerate a sound with the same seed.
- **Quota:** each upload counts against the monthly audio quota (§4 of `roblox-audio.md`). Pick the takes before uploading.
- Generated audio from a cloud tool goes through that company's servers. Don't put private game details in prompts you wouldn't want stored.

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `status`: Mirli not reachable | Start the Mirli app. The endpoint exists only while it runs. Check the port in its settings, or set `MIRLI_URL`. |
| Mirli: "model not installed" | Install it in the app's model manager, or pass `--model` with an installed id from `status`. |
| ElevenLabs HTTP 401 / 402 / 429 | 401: wrong `ELEVENLABS_API_KEY`. 402: out of credits, or the plan lacks the feature. 429: too many requests at once, so lower `--takes`. |
| Loop drifts against the beat after a few repeats | The model didn't hold the BPM. `fit` warns about this. Regenerate with the BPM early in the prompt, or fit at the heard BPM and put it in the cue. |
| The loop starts mid-phrase or on the wrong beat | Listen, then `fit --start <seconds of a downbeat>`. Or try `--bars 4` / `--bars 16` to match the phrase. |
| Audible bump at the loop point | Raise `--xfade` (0.25-0.5 s for pads and ambience; keep it short for drum-heavy music), or generate longer so there's audio after the loop. |
| The intro or a fade-out ended up in the loop | Ask for "no intro, no fade" and two passes. `fit` skips the first bar by default; raise it with `--skip <seconds>`. |
| Vocals or humming appear | `no vocals` early in the prompt. ElevenLabs: `force_instrumental` (always set here). Or separate and drop the vocal stem. |
| SFX too quiet after `fit --oneshot` | Peak-normalised sounds differ in loudness by design. Set `Volume` per sound, or use `--target -18` for a set. |
| Sound has a long noisy tail | Lower `--floor` trims less and raising it trims more (`--floor -40`). Ask for "dry, short tail". |
