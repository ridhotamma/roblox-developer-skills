# Low-poly treasure chest - Blender import script (roblox-modeling skill)
# Run inside Blender:  Scripting tab > Open > this file > Run Script
# or headless:          blender --background --python TreasureChest.blender.py -- [out.blend]
# Imports TreasureChest.glb from the same folder, keeps the low-poly flat shading, puts every animation
# (Open, Close, Rattle) on its own NLA strip so you can switch between them, and optionally saves a .blend.
import bpy, os, sys

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
GLB = os.path.join(HERE, "TreasureChest.glb")
CLIPS = ["Open","Close","Rattle"]

def main():
    if not os.path.exists(GLB):
        raise SystemExit("missing " + GLB)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=GLB)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.type == "MESH":
            for p in o.data.polygons:
                p.use_smooth = False          # faceted low-poly look
    scene = bpy.context.scene
    scene.render.fps = 30
    # one NLA track per clip, muted except the first (best effort: the importer's action layout differs between Blender versions)
    try:
        for o in new:
            ad = o.animation_data
            if not ad:
                continue
            for act in list(bpy.data.actions):
                clip = next((c for c in CLIPS if act.name == c or act.name.startswith(c + "_") or act.name.startswith(c + "|")), None)
                if clip is None or ad.nla_tracks.get(clip):
                    continue
                tr = ad.nla_tracks.new()
                tr.name = clip
                tr.strips.new(clip, int(act.frame_range[0]), act)
                tr.mute = clip != CLIPS[0]
    except Exception as e:
        print("[rmodel] NLA setup skipped: %s" % e)
    end = max([int(a.frame_range[1]) for a in bpy.data.actions] or [scene.frame_end])
    scene.frame_start, scene.frame_end = 0, end
    print("[rmodel] imported %d objects, %d actions: %s" % (len(new), len(bpy.data.actions), ", ".join(a.name for a in bpy.data.actions)))
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if argv:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(argv[0]))
        print("[rmodel] saved " + argv[0])

main()
