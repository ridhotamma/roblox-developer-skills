# Rendering and assets

Low FPS on one player's device with a healthy server is usually rendering. Every frame the CPU decides what is visible (frustum and occlusion culling, both automatic) and prepares draw calls (one per batch of things that share a mesh, material and texture), and the GPU fills the pixels. Either side can be the bottleneck (see "CPU-bound or GPU-bound?" in `profiling.md`). Roblox lowers some quality automatically on weak devices (shadows, lighting detail, view distance, particles), so test at the graphics level your players actually use.

## Draw calls and instancing

- Parts and MeshParts that share the **same mesh, material and texture** are drawn together (instanced). Twenty identical lamp posts cost about the same as one; twenty slightly different lamp posts cost twenty.
- So: build from a **kit of reused meshes** (one fence segment, one tree in a few variants, one rock with rotation and scale variation) instead of many one-off meshes. Colour, rotation and scale usually vary without breaking batching; a different mesh, `TextureID`, material or `SurfaceAppearance` does break it.
- Static anchored parts are merged into render clusters. Changing a property of a part in a cluster (CFrame, Color, Transparency, Size, Material) makes the engine rebuild that geometry (`updateInvalidatedFastClusters` in the MicroProfiler). A few changes per second are fine; hundreds of parts changing every frame are not. Animate on the client, move welded assemblies by their root, and keep frequently changing parts few.
- Every distinct unique mesh and texture also costs memory and download time.

## Geometry

- **Triangle count** matters on phones. Keep hero meshes detailed and background meshes simple; a 20k-triangle rock repeated 300 times is 6M triangles.
- **RenderFidelity** on MeshParts and unions: `Automatic` lets the engine draw simpler versions at distance. `Precise` turns that off: keep it for the few meshes the camera sees up close.
- **Model.LevelOfDetail = StreamingMesh** (with StreamingEnabled): a streamed-out model is drawn as a low-detail stand-in instead of vanishing. Good for buildings and landmarks on big maps.
- **Unions (CSG)** often carry more triangles and heavier collision than an equivalent mesh. For anything repeated, export it as a mesh.
- **Parts vs mesh:** a building made of 400 parts is 400 instances to stream, simulate and cluster. Merging static decor into a few meshes cuts instances, memory and draw calls; keep separate parts only where gameplay needs them (doors, breakables, collision).

## Occlusion culling (automatic, built into the client)

Roblox skips drawing objects that are hidden behind other opaque geometry. It has been on for every experience since late 2024: Windows first, all platforms from January 2025, and Terrain support from mid-2025. Like frustum culling, it's automatic. There is no property to toggle it, no per-instance opt-out, no "occluder" hint, and no API that tells scripts whether something is hidden. It runs on its own thread and the engine tunes how hard it works. It does less when the renderer would have to wait for it, and more when the frame is GPU-bound, so it isn't a cost you budget for.

What it does and doesn't save:

- It removes **draw calls and triangles from the camera view** for hidden objects. In practice, rendering cost then follows what you can see, not what exists in the map. Dense cities and buildings with many rooms gain the most. Arenas, open fields and wide top-down views gain almost nothing, because everything is visible.
- Hidden objects **still cost memory, streaming, physics, scripts and replication**, so StreamingEnabled and the memory budgets still apply.
- Hidden objects **still draw into the shadow map**, because something behind a wall can cast a shadow you see. Shadow casters are never culled, so the CastShadow and light-shadow advice below still applies.
- It is conservative. It tests bounding boxes and gives up when proving something is hidden costs more than drawing it. Some hidden objects still get drawn, and that is expected.

What can block (occlude) and what can be hidden (as of early to mid 2026; Roblox is shrinking this list, so check the DevForum announcement thread):

| | Can occlude others | Gets culled when hidden |
|---|---|---|
| Opaque Part, especially block parts (the cheapest occluder) | yes | yes |
| Opaque MeshPart with a modest vertex count | yes | yes |
| Very detailed mesh, or anything small on screen | no (skipped by heuristic) | yes |
| Terrain | yes | yes (grass decoration is not culled) |
| UnionOperation (CSG), TrussPart | no | yes |
| Anything not fully opaque: Transparency > 0, Glass, ForceField, alpha-cutout or transparent SurfaceAppearance | no | yes |
| Avatars, Humanoid NPCs, AnimationController rigs, skinned meshes (anything animated) | no | no (in testing on PC and Mac in early 2026) |
| Lights, ParticleEmitters, Beams, Trails, BillboardGuis, SurfaceGuis | n/a | no |
| Parts under a Highlight (even a disabled one) | no | no (known limitation as of April 2026) |

Building so it helps:

- **Give hidden detail something solid to hide behind.** Interiors get real walls and ceilings, and streets get buildings that block long sightlines. Hills (Terrain) work too.
- **Make big occluders cheap and opaque.** Build walls, floors and building shells from opaque block parts or simple MeshParts. Don't build them from unions, glass, or semi-transparent or alpha-cutout materials. For a detailed building, use a simple opaque shell mesh that blocks the view, and put the fine detail in separate meshes (a `Detail` child for the kit's LodController).
- **Don't leave Highlights on big models.** Create a Highlight when it's needed (hover, selection, an objective marker) and destroy it afterwards. The `highlighted-parts` scan rule counts parts kept under Highlights in the place.
- **Don't write your own occlusion system in Luau** (raycasting to hide parts by setting Transparency or Parent). The engine already does this better on its own thread, and changing many parts invalidates render clusters and replication. Spend that effort on distance LOD (`PerfLod`) and streaming instead.
- **Open maps** don't benefit, so keep relying on RenderFidelity Automatic, `LevelOfDetail`, the kit's LodController and particle budgets there.

Checking it (in Studio, Play mode):

1. Turn on Studio's wireframe rendering view and stand where a wall hides part of the map. Objects that are hidden and culled disappear from the wireframe. Anything animated, lights and effects stay, as listed above.
2. Open the performance stats overlay (Ctrl+Shift+F2) and compare draw calls and triangles looking at the wall and then looking past it. Triangle counts are a better test than FPS, because a fast GPU hides the difference.
3. Big numbers that stay the same in both views mean the blockers aren't occluding. Look for glass or semi-transparent walls, union walls, very detailed meshes, Highlights, or rigs.

## Textures and materials

- Texture memory is the biggest single cause of mobile crashes. A 1024×1024 texture is several MB in memory once decoded (more with mipmaps); a SurfaceAppearance can carry four maps (colour, normal, metalness, roughness).
- Rules of thumb: small props 256–512 px; large surfaces and characters 1024 px; share one atlas texture across a prop kit; don't give every crate its own texture.
- **SurfaceAppearance** only where it's seen up close. Background meshes use a plain colour/material or a shared texture.
- **MaterialVariants** are shared, so a custom material used on 1,000 parts costs one set of textures.
- **Decals and Textures** each load an image; signs and posters reused across the map should share images.
- UI images count too: icon sheets (one image, `ImageRectOffset`/`ImageRectSize`) instead of hundreds of separate icons.

## Transparency and overdraw

- Opaque surfaces are drawn front to back and hidden pixels are skipped. Semi-transparent surfaces (Transparency between 0 and 1, glass, ForceField material, particles, beams, fog-like decals) are sorted and every layer is drawn, so pixels get painted many times. That is GPU time, worst on phones.
- `Transparency = 1` parts are not drawn (they still cost physics, collision and memory). For invisible collision or trigger parts, also turn off CastShadow.
- Avoid stacking: glass windows in front of glass windows, water planes over fog over particles. Use one layer, and make "glass" that doesn't need to be see-through opaque.
- Big particles near the camera are the classic overdraw spike (smoke filling the screen). Fewer, smaller particles, or a flat decal/fog volume instead.

## Lighting and shadows

- **Lighting.Technology:** Future (per-pixel lights and light shadows; most expensive on GPU), ShadowMap (sun shadows), Voxel and Compatibility (cheapest). The engine scales down on weak devices, but your content decides how much there is to draw.
- **Shadow-casting lights** (`Shadows = true` on PointLight/SpotLight/SurfaceLight) are expensive with Future lighting. Keep shadows on a few key lights near the player; turn them off on fills, decorative and small lights. `Range` matters too: a big range touches more surfaces.
- **CastShadow** on parts: off for small props, trim, interior detail, foliage cards, invisible parts and anything inside a building's shadow anyway. Hundreds of tiny shadow casters add shadow-pass work for no visible gain.
- **Neon** is cheap per part but feeds Bloom.
- Many lights in one view cost even without shadows: prefer a few strong lights plus `Ambient` / `OutdoorAmbient` and emissive (Neon) surfaces for fake light.

## Post-processing and sky

Roughly from expensive to cheap: DepthOfField and Blur (full-screen passes), SunRays, Bloom, ColorCorrection (cheap), Atmosphere (cheap, and replaces old Fog well). Dynamic `Clouds` cost some GPU. On low-end phones, consider turning DoF and SunRays off when the `PerfQuality` attribute (set by the kit's PerfController) is `"Low"`.

## Particles, beams and trails

- **Alive particles ≈ Rate × average Lifetime.** 200 emitters × 20/s × 5 s = 20,000 particles. The engine reduces particle counts at lower quality levels, but plan for the high end too.
- Budget per scene, e.g. under ~2,000–5,000 alive particles on screen for a busy fight, far less idle. Ambient emitters (dust, fireflies, smoke) should be few and disabled when far (tag them `PerfLod`).
- Use `:Emit(n)` bursts for one-off effects instead of enabling an emitter with a high Rate for a moment.
- Prefer fewer, larger, more opaque particles with good textures over many tiny transparent ones.
- Scale your own emitters' rates by the `PerfParticleScale` LocalPlayer attribute (0.4 / 0.7 / 1 by tier) if you have heavy VFX. The `roblox-vfx` skill builds effects that fit these budgets.
- Beams and Trails are cheap individually; hundreds of long trails (every bullet) add up. Pool bullet objects (kit `Pool`) and clear trails on reuse.

## GUI

- Each ScreenGui, Frame, TextLabel and ImageLabel is an instance with layout and render cost. Thousands of UI elements (a 500-item inventory built at once) cost memory and layout time.
- **Long lists:** build only the rows that are visible and reuse them while scrolling (virtualisation), or page the content.
- **Updating text** re-measures and re-renders the label: write `Text` only when the value changed, and not every frame.
- `UIListLayout`/`UIGridLayout` with `AutomaticSize` re-lay out when children change; batch changes.
- `TextScaled` costs more than a fixed `TextSize` with a `UITextSizeConstraint`.
- **ViewportFrames** render their own scene: keep few on screen; use pre-rendered images for static item icons.
- **CanvasGroup** renders its children to a texture (memory): use for effects that need group transparency, not as a default container.
- **BillboardGuis** (nameplates, markers): set `MaxDistance`. Hundreds with no limit draw for everything on the map.
- **SurfaceGuis** each render to a texture: use decals for static signs; keep live SurfaceGuis for screens players read and set their `MaxDistance` / `PixelsPerStud` sensibly.
- Close screens by destroying or disabling (`Enabled = false`), not by moving them off-screen.

## Characters, NPCs and animation

- **Humanoid** is one of the most expensive instances: state machine, physics, ground checks, accessories, clothing and (for player avatars) layered clothing. Dozens are fine, hundreds are not.
- NPCs that only need to walk and animate: a Model with an **AnimationController + Animator** (no Humanoid), moved by your own code. Turrets, pets and props never need a Humanoid.
- Humanoid NPCs that you keep: disable states they never use (`Humanoid:SetStateEnabled(Enum.HumanoidStateType.Climbing, false)`, Swimming, Seated, FallingDown, Ragdoll...), and consider R6 rigs (fewer parts) for crowds.
- Crowds (tower defense, RTS, zombies): the server tracks positions as plain data and replicates compact updates; clients spawn and animate the models. See "Crowds" in `network-physics-streaming.md`.
- **Animation:** every playing track on every visible rig costs CPU. Stop or slow animations for far rigs (`LodLevel` attribute from the kit's LodController); load each track once per character and reuse it.
- Accessories and clothing on NPCs: fewer accessories, shared meshes and textures.

## Physics flags for decor (they cost even when nothing moves)

| Property | For decor, set | Why |
|---|---|---|
| Anchored | true | Not simulated |
| CanCollide | false where players can't touch it anyway | Fewer collision checks |
| CanTouch | false unless something listens to Touched | No touch events and less contact work |
| CanQuery | false (only possible when CanCollide is false) if raycasts should ignore it | Smaller query structures |
| CollisionFidelity | Box (or Hull) | Precise collision geometry is built and stored per mesh |
| CastShadow | false for small things | Less shadow work |

## A builder's checklist

- Reuse a small kit of meshes; vary with rotation, scale and colour.
- Walls, floors and building shells are opaque parts or simple meshes (not unions, not glass) so occlusion culling can hide what's behind them; no long-lived Highlights on big models.
- Textures 256–512 for props, shared atlases, SurfaceAppearance only up close.
- No stacked transparency; invisible parts are fully transparent with shadows off.
- Shadows on a handful of key lights; CastShadow off for small props.
- Decor anchored, Box collision, CanTouch off.
- Detail that only matters up close goes in a `Detail` child and the model gets the `PerfLod` tag; heavy models get `LevelOfDetail = StreamingMesh`.
- Ambient particle emitters are few, low Rate, tagged for LOD.
- Run `assets/studio/PerfAudit.luau` in the command bar before every big map update.
