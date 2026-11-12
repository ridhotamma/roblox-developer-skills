# Lighting reference

## Contents
1. The flat-game checklist
2. Lighting service
3. Technology
4. Atmosphere (fog and haze)
5. Post effects: ColorCorrection, Bloom, SunRays, DepthOfField, Blur
6. Sky and Clouds
7. Practical lights and Neon
8. Colour and value
9. Readability
10. Performance and devices

---

## 1. The flat-game checklist
Why a Roblox game looks "default", in the order to fix it:
1. **No fog.** Without Atmosphere, distance has no depth and map edges show. Add Atmosphere with a tinted Color (not grey) and Density 0.25-0.4.
2. **Grey neutral ambient.** Default Ambient/OutdoorAmbient are flat grey. Give fill a temperature: cool (blue) under a warm sun, warm under a cool moon.
3. **Noon sun.** ClockTime 12-14 gives short shadows and no shape. Move the sun to 8-10 or 16-17.5 unless readability needs noon (obby).
4. **No colour grade.** One ColorCorrection with a slight TintColor, ±0.1-0.2 Saturation and +0.05-0.15 Contrast unifies everything.
5. **No practical lights.** Lamps, windows, torches, neon give the eye places to go and make the world look lived in.
6. **No sound bed.** Silence makes any visual feel unfinished.
7. **Bloom left at default with everything glowing**, or no bloom at all. Tune Threshold so only real light sources bloom.
8. **Materials and palette**: too many saturated colours fight any lighting. Out of scope here, but often the real issue.

## 2. Lighting service

| Property | Range | What it does | Notes |
|---|---|---|---|
| ClockTime | 0-24 | Sun/moon position | 6 and 18 are sunrise/sunset; the moon lights the night. Tweening across midnight needs wrap handling (the kit does it). |
| GeographicLatitude | -90-90 | Sun path tilt | Changes how high the sun gets; rarely needed. |
| Brightness | 0-10 | Intensity of the sun/moon | 2-3 typical day, 0.5-1.2 night, 0 for underground (no sun at all). |
| Ambient | Color3 | Fill in areas the sky can't see (interiors, under roofs) | Interiors live and die on this. |
| OutdoorAmbient | Color3 | Fill outdoors | The colour of shadows outside. Keep > (30,30,40) at night for readability. |
| ColorShift_Top | Color3 | Tint of sunlit surfaces | Warm it at golden hour, cool it at night. |
| ColorShift_Bottom | Color3 | Tint of surfaces facing away from the sun | Subtle bounce colour. |
| EnvironmentDiffuseScale | 0-1 | Ambient light from the skybox | 1 = sky colours the shadows (realistic); 0 for interiors and caves, where the sky shouldn't contribute. |
| EnvironmentSpecularScale | 0-1 | Skybox reflections on smooth/metal surfaces | 1 for wet streets, metal, sci-fi floors; low for matte stylized looks. |
| ExposureCompensation | -3-3 | Overall exposure in stops | The quick "too dark/too bright" fix after everything else; small steps (0.1-0.3). |
| ShadowSoftness | 0-1 | Shadow edge blur (ShadowMap/Future) | 0 hard (space, desert), 0.8-1 overcast. |
| GlobalShadows | bool | Sun/moon shadows on or off | Keep on. |
| FogStart/FogEnd/FogColor | | Legacy fog | **Ignored when an Atmosphere exists.** Use Atmosphere. |

## 3. Technology
- **Future**: per-pixel lighting, shadows from point/spot/surface lights. Best for interiors, horror, neon, anything lit by practical lights. Most expensive.
- **ShadowMap**: sun shadows sharp, local lights without shadows. Good default for large outdoor maps, obbies, PvP.
- **Voxel**: cheapest, blocky light; what low-end devices effectively fall back toward.
- Technology is **not scriptable at runtime**: set it in Studio (the kit's command-bar script tries and warns). Newer Studio versions may expose this under different lighting style/quality properties; set the equivalent.
- Whatever you choose, low graphics quality and many phones reduce local-light quality. Design for the fallback.

## 4. Atmosphere (fog and haze)

| Property | Range | What it does | Rule of thumb |
|---|---|---|---|
| Density | 0-1 | How thick the air is; the main sight-distance control | 0.2 clear, 0.3-0.4 atmospheric, 0.45-0.55 moody, 0.6-0.8 heavy fog / whiteout / underwater |
| Offset | 0-1 | How the haze relates to the sky / horizon | Higher = more haze on the skybox and horizon (airy); 0 keeps the sky darker and fog "in front" |
| Color | Color3 | Colour of the haze | The single most important mood colour. Tint it. |
| Decay | Color3 | Colour away from the sun / at the haze's thick end | Darker or complementary to Color for depth; at sunset use a red-orange. |
| Glare | 0-10 | Glow around the sun in the haze | 0 for night/fog/interiors, 0.5-1.5 golden hour and desert |
| Haze | 0-10 | Haze on the horizon and its brightness | 0.3-1 clean, 1.5-3 dusty/humid, 4+ blizzard |

Tips:
- Fog colour roughly matching the lower sky makes the horizon seamless.
- In horror, fog slightly brighter than the geometry makes silhouettes readable.
- Each zone preset can change Density: tighter in forests and caves, wider in plains.
- Map edges: Density so the far edge is ~90% fogged from the farthest reachable point.

## 5. Post effects
All live in Lighting (or the Camera). Several of the same class stack.

**ColorCorrectionEffect** (the kit calls it "Grade")
| Property | Range | Use |
|---|---|---|
| Brightness | about -0.5-0.5 | Lift or crush; tiny values (±0.02-0.05) |
| Contrast | -1-1 | +0.1-0.3 for drama/noir, slightly negative for soft dreamy or liminal |
| Saturation | -1-1 | -1 is greyscale; horror -0.3 to -0.6, cartoon +0.2 to +0.3 |
| TintColor | Color3 | Multiplies the image; keep it near white (230-255 per channel) |

**BloomEffect**
| Property | Range | Use |
|---|---|---|
| Intensity | 0-1 | How strong the glow is |
| Size | 0-56 | Glow spread |
| Threshold | 0-4 | Brightness above which pixels bloom. Low (0.9-1.2) = neon/magic glows; high (2+) = only the sun and real lights |
Bloom makes Neon parts and bright lights read as light sources; too low a Threshold makes white walls glow.

**SunRaysEffect**: Intensity 0-1, Spread 0-1. God rays when the sun is visible. 0.05-0.15 subtle, 0.2-0.3 dramatic (forests, underwater, golden hour). Avoid in competitive games.

**DepthOfFieldEffect**: FarIntensity, FocusDistance, InFocusRadius, NearIntensity. Great for menus, cutscenes, underwater and photo modes; avoid in gameplay where players must see far (FPS, PvP). Often off at low quality.

**BlurEffect**: Size. Use for menus/pauses only (tween it in when UI opens).

## 6. Sky and Clouds
- **Sky**: skybox textures (6 faces), `CelestialBodiesShown`, `StarCount` (0-5000; only visible at night or with a dark skybox), `SunAngularSize` (default 21; bigger at sunset feels dramatic), `MoonAngularSize`, sun/moon textures. A good skybox is half the atmosphere outdoors: choose one whose colours match the fog.
- **Clouds** (child of Terrain): `Cover` 0-1, `Density` 0-1, `Color`. Dynamic, lit by the sun; full cover + grey colour = overcast. They move with `workspace.GlobalWind`.

## 7. Practical lights and Neon
| Light | Key properties | Use |
|---|---|---|
| PointLight | Brightness, Range (≤ 60), Color, Shadows | Torches, bulbs, glowing items |
| SpotLight | + Angle, Face | Flashlights, streetlamps, stage lights |
| SurfaceLight | + Angle, Face | Windows, screens, light panels |

- **Neon material** looks emissive (glows with bloom) but emits no light: pair it with a light for real illumination.
- Light counts: dozens are fine, hundreds near each other aren't. Turn `Shadows` on for a few hero lights only; shadow-casting lights are the costly ones in Future.
- Warm practical colours: candle (255,170,90), tungsten (255,200,140), sodium street (255,180,90). Cool: fluorescent (230,245,255), moon (170,190,255), sci-fi (120,220,255).
- Tag lights `AtmosphereAccent` so presets recolour them (one map, many moods); `Flicker` to animate.

## 8. Colour and value
- **Value first**: the darkest darks and lightest lights should be where you want attention (the goal, the threat).
- **Temperature contrast**: cool fill + warm key (cozy, golden hour, horror lantern), or warm fill + cool key (alien, underwater, sci-fi alarms).
- **60-30-10**: 60% dominant hue (fog/ambient), 30% secondary (environment), 10% accent (lights, interactables).
- **Saturation budget**: saturate what matters (pickups, players, goals), desaturate the background.
- **One mood colour per area** makes regions memorable and helps navigation ("the green swamp", "the red caves").

## 9. Readability
- Players must read: the path, interactables, enemies and attacks, other players. Check each against the darkest and brightest preset you ship.
- Avatar vs background contrast: aim ≥ 1.6:1 luminance contrast in gameplay presets (the lab measures it). Horror can go lower deliberately, but threats need sound or glow then.
- Use `Highlight` (outline) for teammates, objectives and grabbed items rather than lighting the whole map brighter.
- Dense fog + fast movement = collisions players can't see: tune fog to movement speed.

## 10. Performance and devices
- Post effects are cheap on PC, noticeable on low-end phones; many are reduced automatically at low quality. Don't stack several of the same effect.
- Future + many shadow-casting lights is the main cost. Prefer ShadowMap for huge outdoor maps.
- Weather particles: the kit's defaults peak around 700-1200 particles/s for heavy rain; halve `Intensity` on low-end (check `UserSettings().GameSettings.SavedQualityLevel` on the client).
- Test: Studio's device emulator plus a real phone at quality 1-3, both indoors and outdoors (screen glare).
