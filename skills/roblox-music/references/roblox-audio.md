# Roblox audio for adaptive music

## Contents
1. Audio API vs Sound objects
2. Keeping stems in sync
3. Loops without clicks
4. Uploading: formats, limits, permissions
5. Loading and memory
6. Ducking, volume settings and the mix
7. Licensing
8. Troubleshooting

---

## 1. Audio API vs Sound objects

The kit uses the **Audio API** (AudioPlayer, AudioFader, AudioDeviceOutput, Wire). Reasons:
- `AudioPlayer:Play(atTime)` and `:Stop(atTime)` schedule against `SoundService:GetMixerTime()`: the mixer's own clock, independent of frame rate. Starting every stem at the same `atTime` is what keeps layers locked.
- Every stem gets its own `AudioFader`, so layer volumes never touch the player's settings or each other.
- Effects are instances in a graph (AudioEqualizer, AudioReverb, AudioCompressor with a sidechain pin, AudioFilter), wired with `Wire` objects (`SourceInstance` → `TargetInstance`).

Behaviour to know:
- `AudioPlayer:Play()` **resumes** from `TimePosition` (a `Sound` rewinds to 0). The kit sets `TimePosition` before each `Play`.
- `Asset` holds the content id (`rbxassetid://123`); `AssetId` is deprecated.
- `IsReady` is true once the asset is loaded and buffered (it can drop back under memory pressure).
- `Looping` loops the whole asset, or `LoopRegion` within `PlaybackRegion` when set.
- `SoundService.AmbientReverb` and `SoundGroup`s don't affect AudioPlayers; use AudioReverb / AudioFader in the graph instead.

Legacy `Sound` objects still work (`Sound.TimePosition`, `SoundGroup` volume), but starting several at the same moment from Lua is only frame-accurate, and changing `TimePosition` mid-play is a known cause of drift between tracks. If a project must use Sounds: start all stems in the same frame from `TimePosition = 0`, never seek them, and keep their lengths identical.

## 2. Keeping stems in sync

What the kit does, and what any hand-written player should do:
1. Create one AudioPlayer per stem, all with the same length.
2. Wait until every one is `IsReady` (or a timeout).
3. Read `local t = SoundService:GetMixerTime() + 0.1` (lead time so the schedule is in the future).
4. `player.TimePosition = offset` then `player:Play(t)` for every stem with the **same** `t`.
5. Change volumes only through each stem's AudioFader; never stop, seek or restart one stem alone.
6. Schedule switches on the playing cue's grid: `MusicTimeline.NextBoundary(cue, startTime, GetMixerTime() + lead, "Bar")`, then `Play(atTime)` the new stems and `Stop(atTime + fade)` the old ones.

`GetMixerTime` is wrapped in `pcall` in `MusicPlayer`; without it the kit falls back to `os.clock()` and unscheduled `Play()` (stems still start together, within a frame).

## 3. Loops without clicks

- **Every stem exactly the loop length** (`bars × beatsPerBar × 60 / bpm` seconds, rounded once to samples). The CLI prints the sample count; `analyze` checks it.
- **Tail wrapped onto the start.** A reverb or a note that rings past the loop end must be added to the beginning of the file, or the loop point cuts it off (a click or a "hole"). The generator renders the loop with its tails, folds them back (periodic summation), crossfades held notes into themselves and runs reverb/delay on the loop in steady state.
- **WAV, FLAC or OGG for loops, not MP3:** MP3 encoders add silence at the start and end, which turns into a gap or pop on every loop.
- **No fades at the file edges** for loops (they make a dip each repetition). One-shots get a short fade-out.
- **Zero-crossing doesn't matter** when the tail is wrapped correctly; the last sample flows into the first.

## 4. Uploading: formats, limits, permissions

From the Creator Hub audio assets page:
- Formats: `.mp3`, `.ogg`, `.wav`, `.flac`, single stream.
- Max **7 minutes**, under **20 MB**, sample rate up to **48 kHz**, mono or stereo (also 3.0 and 5.1).
- Quota: ID-verified accounts can import 2,000 audio assets per 30 days; unverified accounts 100.
- New audio is **private**: only you (or the group) can use it until you grant use to specific experiences in the asset's permissions. Upload under the group that owns the game, or share it with the experience, or it plays silently for everyone else.
- A 16-bit 44.1 kHz stereo WAV is about 10 MB per minute: an 8-bar loop at 120 BPM (16 s) is ~2.8 MB. Use FLAC to halve it, or OGG for long linear tracks.
- Bulk upload: Studio's **Asset Manager → Bulk Import** (select all the WAVs from `render`), then copy each id into `MusicCues.luau`. Open Cloud's Assets API can automate it with an API key you create.
- Uploads are moderated; synthesized music passes, voices and copyrighted material may be rejected.

## 5. Loading and memory

- Each playing cue = N stems decoded in memory. 5 stems × 20 s stereo is small; 5 stems × 3 minutes is not. Keep loops short (8-16 bars) and let layering create variety.
- The first `Play` of a cue loads its stems; `MusicPlayer` waits for `IsReady` up to `Transition.LoadTimeout` (8 s) before starting anyway. To make the first switch instant, load early: `MusicController:Preload("action_combat")` during the loading screen, before a boss door, or when a heist starts.
- Only cues that are playing or fading have instances; old ones are destroyed after their fade.
- Stingers and one-shots are created per play and destroyed on `Ended`.

## 6. Ducking, volume settings and the mix

- **Player volume:** set the `MusicVolume` attribute (0-1) on the Player from your settings menu; the controller multiplies it with `MusicConfig.Volume`. Persist the setting with your data store.
- **Off switch:** `MusicController:SetEnabled(false)` fades out on the next bar; sources keep updating, so turning it back on resumes the right state.
- **Dialogue and cutscenes:** `MusicController:Duck(0.6)` then `Duck(0)`.
- **Automatic ducking under SFX (sidechain):** add an `AudioCompressor` between the music bus and the output and wire the SFX you care about into its `Sidechain` pin:
  ```lua
  local music = SoundService.Music
  local comp = Instance.new("AudioCompressor")
  comp.Threshold = -30; comp.Ratio = 4; comp.Attack = 0.01; comp.Release = 0.3
  comp.Parent = music
  -- re-route Bus -> Compressor -> Out
  for _, w in music.Bus:GetChildren() do if w:IsA("Wire") then w:Destroy() end end
  local function wire(a, b, pin) local w = Instance.new("Wire"); w.SourceInstance = a; w.TargetInstance = b; if pin then w.TargetName = pin end; w.Parent = b end
  wire(music.Bus, comp); wire(comp, music.Out)
  wire(myExplosionPlayer, comp, "Sidechain") -- each sound that should push the music down
  ```
- **Levels:** music full mix around -16 LUFS; leave the loudest SFX room above it. If the music feels loud in game, lower `MusicConfig.Volume` (0.4-0.6 is typical), not the stems.

## 7. Licensing

- Upload only audio you have the rights to. Generated stems from this skill are yours.
- The Creator Store's audio library includes music licensed by Roblox for use in experiences; it is linear (no stems), so use it for menus or radios, not adaptive layers.
- Don't recreate or "sound-alike" copyrighted game scores (no GTA, Doom or Dead Space themes): the moods borrow techniques, not melodies.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Silence, no errors | Asset ids empty, or private and not shared with the experience | Fill `Asset`; grant the experience use in the asset's permissions |
| Warning "cue has no stem asset ids yet" | Same | Same |
| Stems drift apart over time | Different lengths, or something seeks/restarts one stem | Re-export at exactly the loop length; only change fader volumes |
| Click at the loop point | MP3, missing tail wrap, fade at file edges | WAV/FLAC/OGG; wrap the tail; `analyze` reports the seam |
| First combat switch is late | Stems loading | Preload during loading screen; shorter stems |
| Switch lands off-beat | Lead too small, or cue Bpm/BeatsPerBar in `MusicCues` don't match the files | Check the entry against `<cue>.cue.json`; raise `Transition.Lead` to 0.15-0.2 |
| Music changes too often | Hold/MinDwell too short, sources flicker | Raise Hold/MinDwell; give pulse sources a ttl instead of set/clear every frame |
| Music too slow to react | Attack low, Sync = Phrase/Loop | Attack 1.5-2; Sync = Beat for combat |
| Everyone hears one player's fight | Music driven from server-wide state | Use `MusicService:SetPlayerState` or client sources |
