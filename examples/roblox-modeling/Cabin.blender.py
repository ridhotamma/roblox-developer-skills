# Low-poly one-room cabin - Blender import script (roblox-modeling skill)
# Run inside Blender:  Scripting tab > Open > this file > Run Script
# or headless:          blender --background --python Cabin.blender.py -- [out.blend]
# Imports Cabin.glb from the same folder, keeps its shading (the file's normals: faceted or smoothed per part), puts each animation
# (DoorOpen, DoorClose) on its own muted NLA track on the objects it moves (the scene shows the rest pose: un-mute or solo
# a track in the NLA editor to play it), and optionally saves a .blend.
import bpy, os, sys

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
GLB = os.path.join(HERE, "Cabin.glb")
CLIPS = ["DoorOpen","DoorClose"]

def main():
    if not os.path.exists(GLB):
        raise SystemExit("missing " + GLB)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=GLB)
    new = [o for o in bpy.data.objects if o not in before]   # the importer keeps the file's normals (hard and smooth edges)
    scene = bpy.context.scene
    scene.render.fps = 30
    # one muted NLA track per clip, only on the objects that clip animates: Blender 4.4+ actions have a slot per target
    # object; older importers make one action per object, named "<clip>_<object>". A clip put on an object it does not
    # animate would still drive it (a roof turning with a door), so the target matters.
    def slot_for(act, o):
        slots = getattr(act, "slots", None)
        if slots is None or not len(slots):
            return None
        return next((s for s in slots if s.name_display == o.name or s.identifier[2:] == o.name), False)
    try:
        for o in new:
            ad = o.animation_data
            if not ad:
                continue
            ad.action = None
            for tr in list(ad.nla_tracks):
                ad.nla_tracks.remove(tr)
            for act in list(bpy.data.actions):
                clip = next((c for c in CLIPS if act.name == c or act.name.startswith(c + "_") or act.name.startswith(c + "|")), None)
                if clip is None or ad.nla_tracks.get(clip):
                    continue
                slot = slot_for(act, o)
                if slot is False or (slot is None and act.name != clip and not act.name.endswith(("_" + o.name, "|" + o.name))):
                    continue
                tr = ad.nla_tracks.new()
                tr.name = clip
                strip = tr.strips.new(clip, int(act.frame_range[0]), act)
                if slot:
                    strip.action_slot = slot
                tr.mute = True
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
