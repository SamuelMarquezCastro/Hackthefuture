# Gebruik: blender --background --python bouw_raad.py -- raad.glb   (of: pip install bpy; python bouw_raad.py -- raad.glb)
# Bouwt de 7 low-poly personages van de Raadszaal in Blender en exporteert ze als raad.glb.
# Elke rol is een lege knoop met de naam van de rol, met daaronder <rol>_lijf (vertex-kleuren) en <rol>_voorwerp (gloeit).
# Blender: x = rechts, -y = naar de tafel (voorkant), z = omhoog. Oorsprong = midden van de zitting, op de vloer.
import bpy, bmesh, math, sys
from mathutils import Matrix, Vector, Euler

UIT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "/tmp/raad.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)

def hexkleur(h):
    h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)

class Bouwer:
    def __init__(self):
        self.bm = bmesh.new()
        self.kleur = self.bm.loops.layers.color.new("Kleur")

    def _kleur(self, verts, k):
        k = hexkleur(k)
        vs = set(verts)
        for f in {f for v in verts for f in v.link_faces}:
            if all(v in vs for v in f.verts):
                for l in f.loops: l[self.kleur] = k

    def _m(self, loc, rot=(0, 0, 0), schaal=(1, 1, 1)):
        return Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(schaal))

    def blok(self, loc, maat, k, rot=(0, 0, 0)):
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=self._m(loc, rot, maat)); self._kleur(r["verts"], k); return r

    def kegel(self, loc, r1, r2, hoogte, k, seg=8, rot=(0, 0, 0), schaal=(1, 1, 1)):
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=hoogte,
                                  matrix=self._m(loc, rot, schaal)); self._kleur(r["verts"], k); return r

    def bol(self, loc, straal, k, schaal=(1, 1, 1), u=8, v=6, rot=(0, 0, 0)):
        r = bmesh.ops.create_uvsphere(self.bm, u_segments=u, v_segments=v, radius=straal, matrix=self._m(loc, rot, schaal))
        self._kleur(r["verts"], k); return r

    def ico(self, loc, straal, k, schaal=(1, 1, 1), sub=1):
        r = bmesh.ops.create_icosphere(self.bm, subdivisions=sub, radius=straal, matrix=self._m(loc, (0, 0, 0), schaal))
        self._kleur(r["verts"], k); return r

    def staaf(self, a, b, dikte, k, seg=None):
        a, b = Vector(a), Vector(b); d = b - a; lengte = d.length
        rot = d.to_track_quat("Z", "Y").to_euler()
        if seg: return self.kegel((a + b) / 2, dikte, dikte * 0.85, lengte, k, seg=seg, rot=rot)
        return self.blok((a + b) / 2, (dikte, dikte, lengte), k, rot=rot)

    def maak(self, naam, ouder, schaal=1.0):
        if schaal != 1.0: bmesh.ops.scale(self.bm, vec=(schaal, schaal, schaal), verts=self.bm.verts)
        me = bpy.data.meshes.new(naam); self.bm.to_mesh(me); self.bm.free()
        me.color_attributes.active_color_name = "Kleur"; me.color_attributes.render_color_index = 0
        for p in me.polygons: p.use_smooth = False
        ob = bpy.data.objects.new(naam, me); ob.parent = ouder
        bpy.context.collection.objects.link(ob); return ob

def materiaal(naam, emissie=None, sterkte=0.0):
    m = bpy.data.materials.new(naam); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes["Principled BSDF"]
    ca = nt.nodes.new("ShaderNodeVertexColor"); ca.layer_name = "Kleur"
    nt.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    if emissie:
        bsdf.inputs["Emission Color"].default_value = hexkleur(emissie)
        bsdf.inputs["Emission Strength"].default_value = sterkte
    return m

HUID = "#d9a988"; DONKER = "#140a14"; LAARS = "#2a1a12"

def lichaam(b, kleed, broek, huid=HUID, armkleur=None):
    armkleur = armkleur or kleed
    b.blok((0, 0.02, 0.9), (0.5, 0.42, 0.2), broek)                       # bekken op de zitting
    for x in (-0.13, 0.13):
        b.blok((x, -0.22, 0.88), (0.17, 0.46, 0.17), broek)               # dijen
        b.blok((x, -0.44, 0.45), (0.15, 0.15, 0.8), broek)                # schenen
        b.blok((x, -0.52, 0.06), (0.16, 0.3, 0.12), LAARS)                # voeten
    b.kegel((0, 0.02, 1.38), 0.37, 0.27, 0.82, kleed, seg=8)              # romp
    b.bol((0, 0.02, 1.74), 0.3, kleed, schaal=(1.35, 0.8, 0.45))          # schouders
    for s in (-1, 1):
        sch, elb, hand = (s * 0.37, 0.02, 1.7), (s * 0.4, -0.3, 1.36), (s * 0.24, -0.95, 1.31)
        b.staaf(sch, elb, 0.15, armkleur); b.staaf(elb, hand, 0.13, armkleur)
        b.blok(hand, (0.11, 0.13, 0.08), huid)                            # handen op tafel
    b.kegel((0, 0.02, 1.85), 0.09, 0.08, 0.14, huid, seg=6)               # nek
    b.bol((0, 0.0, 2.03), 0.22, huid, schaal=(1, 0.95, 1.1))              # hoofd
    for x in (-0.075, 0.075): b.blok((x, -0.205, 2.06), (0.05, 0.02, 0.06), DONKER)  # ogen
    b.kegel((0, -0.235, 2.0), 0.035, 0.0, 0.07, huid, seg=4, rot=(math.pi / 2, 0, 0))  # neus

def baard(b, k, lang=0.35):
    b.kegel((0, -0.15, 1.92 - lang / 2 + 0.05), 0.0, 0.16, lang, k, seg=6, rot=(0.25, 0, 0))

def voorwerp(naam, ouder, bouw, kleur, emissie, sterkte=1.0, schaal=1.0):
    b = Bouwer(); bouw(b)
    ob = b.maak(naam, ouder, schaal); ob.data.materials.append(materiaal(naam + "_mat", emissie, sterkte)); return ob

def rol(naam, bouw_lijf, bouw_voorwerp, emissie, schaal=1.0):
    knoop = bpy.data.objects.new(naam, None); bpy.context.collection.objects.link(knoop)
    b = Bouwer(); bouw_lijf(b)
    lijf = b.maak(naam + "_lijf", knoop, schaal); lijf.data.materials.append(materiaal(naam + "_lijfmat"))
    voorwerp(naam + "_voorwerp", knoop, bouw_voorwerp, None, emissie, 1.0, schaal)
    return knoop

# ── Archmage: diepe paarse mantel, punthoed met rand, lange witte baard, staf met kristal ──
def archmage(b):
    lichaam(b, "#5a3ab8", "#2a1a5a")
    b.kegel((0, 0.02, 1.0), 0.42, 0.4, 0.06, "#e8c45a", seg=8)            # gouden zoom
    baard(b, "#eeeeea", 0.42)
    b.kegel((0, 0.0, 2.19), 0.38, 0.38, 0.03, "#3a2290", seg=10)          # hoedrand
    b.kegel((0, 0.0, 2.42), 0.22, 0.12, 0.45, "#4a2aa8", seg=8)
    b.kegel((0, 0.05, 2.78), 0.12, 0.0, 0.35, "#4a2aa8", seg=8, rot=(0.35, 0, 0))
    b.kegel((0, 0.0, 2.24), 0.225, 0.225, 0.05, "#e8c45a", seg=8)          # hoedband
    b.staaf((0.55, -0.2, 0.0), (0.55, -0.2, 2.55), 0.04, "#5a3a1e", seg=5) # staf
def archmage_v(b):
    b.ico((0.55, -0.2, 2.68), 0.11, "#c8a8ff", schaal=(1, 1, 1.5), sub=0)

# ── Engineer: oranje overall, gele helm, bril op het voorhoofd, gereedschapsriem, terminal op tafel ──
def engineer(b):
    lichaam(b, "#e07a18", "#5a3a20", armkleur="#e07a18")
    b.kegel((0, 0.02, 1.12), 0.36, 0.36, 0.08, "#3a2818", seg=8)          # riem
    for x in (-0.22, 0.0, 0.22): b.blok((x, -0.3, 1.1), (0.08, 0.06, 0.1), "#8a8a90")
    b.bol((0, 0.0, 2.1), 0.245, "#f0c020", schaal=(1, 1, 0.85), u=8, v=4)  # helm
    b.kegel((0, -0.05, 2.08), 0.3, 0.3, 0.03, "#f0c020", seg=8)            # helmrand
    for x in (-0.08, 0.08): b.kegel((x, -0.215, 2.16), 0.055, 0.055, 0.05, "#40d0ff", seg=6, rot=(math.pi / 2, 0, 0))
    b.blok((0, -0.2, 2.16), (0.3, 0.03, 0.03), "#303030")
    b.staaf((0.42, -0.6, 1.3), (0.6, -0.85, 1.29), 0.05, "#a0a0a8")        # moersleutel
def engineer_v(b):
    b.blok((-0.1, -1.05, 1.3), (0.5, 0.34, 0.05), "#203040")               # terminal
    b.blok((-0.1, -0.95, 1.48), (0.46, 0.04, 0.3), "#20a0ff", rot=(-0.3, 0, 0))

# ── Guardian Keeper: harnas, blauwe tabbaard, helm met pluim, groot schild ──
def guardian(b):
    lichaam(b, "#8a92a4", "#3a4050", armkleur="#9aa2b4")
    b.blok((0, -0.25, 1.35), (0.34, 0.06, 0.7), "#1f6ab0")                 # tabbaard
    b.blok((0, -0.285, 1.42), (0.08, 0.02, 0.3), "#e8c45a"); b.blok((0, -0.285, 1.5), (0.22, 0.02, 0.07), "#e8c45a")
    for s in (-1, 1): b.bol((s * 0.38, 0.02, 1.76), 0.15, "#a8b0c0", schaal=(1.1, 1, 0.8), u=6, v=4)  # schouderstukken
    b.kegel((0, 0.0, 2.08), 0.25, 0.23, 0.36, "#a8b0c0", seg=8)            # helm
    b.blok((0, -0.235, 2.06), (0.26, 0.03, 0.05), DONKER)                  # vizierspleet
    b.kegel((0, 0.04, 2.36), 0.05, 0.12, 0.25, "#2f9ee0", seg=5, rot=(-0.4, 0, 0))  # pluim
def guardian_v(b):
    r = b.kegel((-0.62, -0.25, 1.35), 0.38, 0.38, 0.06, "#2f70c0", seg=6, rot=(0, math.pi / 2, 0), schaal=(1, 1, 1))
    b.blok((-0.66, -0.25, 1.35), (0.03, 0.08, 0.55), "#e8c45a"); b.blok((-0.66, -0.25, 1.42), (0.03, 0.4, 0.08), "#e8c45a")

# ── Historian: bruine pij met kap, ronde bril, veer, groot open boek ──
def historian(b):
    lichaam(b, "#6a4422", "#3a2414")
    b.bol((0, 0.11, 2.08), 0.27, "#5a3618", schaal=(1.05, 1.0, 1.15), u=8, v=6)  # kap (achter het hoofd)
    b.kegel((0, 0.12, 2.25), 0.18, 0.0, 0.3, "#5a3618", seg=6, rot=(-0.6, 0, 0))
    b.bol((0, -0.02, 2.03), 0.225, HUID, schaal=(1, 0.95, 1.1))            # gezicht voor de kap
    for x in (-0.075, 0.075):
        b.blok((x, -0.215, 2.06), (0.05, 0.02, 0.06), DONKER)
        b.kegel((x, -0.225, 2.06), 0.06, 0.06, 0.015, "#c8a040", seg=6, rot=(math.pi / 2, 0, 0))
    b.kegel((0, -0.255, 2.0), 0.035, 0.0, 0.07, HUID, seg=4, rot=(math.pi / 2, 0, 0))
    baard(b, "#9a9a9a", 0.22)
    b.staaf((0.3, -0.9, 1.32), (0.42, -0.75, 1.6), 0.02, "#f4f0e0")        # veer
def historian_v(b):
    for s in (-1, 1): b.blok((s * 0.16, -1.05, 1.29), (0.3, 0.4, 0.04), "#f0e4c0", rot=(0, s * -0.12, 0))
    b.blok((0, -1.05, 1.27), (0.66, 0.44, 0.03), "#6a2a1a")

# ── Oracle: roze gewaad, sluier, lang haar, derde oog, kristallen bol ──
def oracle(b):
    lichaam(b, "#c03a80", "#5a1a40")
    b.bol((0, 0.05, 2.02), 0.25, "#3a1a4a", schaal=(1.05, 1.05, 1.15))     # haar
    b.kegel((0, 0.1, 1.72), 0.18, 0.3, 0.5, "#3a1a4a", seg=6)
    b.bol((0, -0.01, 2.03), 0.222, HUID, schaal=(1, 0.95, 1.1))
    for x in (-0.075, 0.075): b.blok((x, -0.215, 2.06), (0.05, 0.02, 0.04), DONKER)
    b.kegel((0, -0.245, 2.0), 0.035, 0.0, 0.07, HUID, seg=4, rot=(math.pi / 2, 0, 0))
    b.kegel((0, 0.0, 2.17), 0.24, 0.24, 0.04, "#e8c45a", seg=8)            # hoofdband
    b.ico((0, -0.24, 2.17), 0.04, "#40ffe0", sub=0)                        # derde oog
    b.kegel((0, 0.05, 2.12), 0.36, 0.2, 0.5, "#f0a0d8", seg=8, rot=(0.15, 0, 0))  # sluier
def oracle_v(b):
    b.kegel((0, -1.0, 1.3), 0.1, 0.14, 0.08, "#e8c45a", seg=6)
    b.ico((0, -1.0, 1.48), 0.17, "#ffa0e8", sub=1)

# ── Beast Master: groene tuniek, pelsmantel, gewei, raaf op de schouder ──
def beast(b):
    lichaam(b, "#2f8a4a", "#3a2a1a")
    for i, (x, z) in enumerate([(-0.32, 1.78), (0.32, 1.78), (-0.18, 1.86), (0.18, 1.86), (0, 1.84), (0, 1.66)]):
        b.ico((x, 0.06, z), 0.17, "#6a5034" if i % 2 else "#7a5e3c", schaal=(1.2, 1, 0.8), sub=0)  # pels
    b.bol((0, 0.02, 2.1), 0.235, "#5a4028", schaal=(1, 1, 0.7), u=8, v=4)  # pelsmuts
    for s in (-1, 1):
        b.staaf((s * 0.12, 0, 2.2), (s * 0.3, 0, 2.55), 0.04, "#e0d0a8")
        b.staaf((s * 0.3, 0, 2.55), (s * 0.48, 0, 2.62), 0.035, "#e0d0a8")
        b.staaf((s * 0.24, 0, 2.45), (s * 0.28, -0.05, 2.68), 0.03, "#e0d0a8")
        b.staaf((s * 0.38, 0, 2.58), (s * 0.42, 0.02, 2.75), 0.03, "#e0d0a8")
    # raaf op de linkerschouder
    b.bol((-0.36, 0.05, 1.98), 0.09, "#16121c", schaal=(0.8, 1.2, 1))
    b.bol((-0.36, -0.04, 2.08), 0.06, "#16121c")
    b.kegel((-0.36, -0.11, 2.08), 0.025, 0.0, 0.07, "#d0a020", seg=4, rot=(math.pi / 2, 0, 0))
    b.blok((-0.36, 0.17, 1.96), (0.08, 0.14, 0.03), "#16121c", rot=(0.4, 0, 0))
def beast_v(b):
    b.kegel((0.3, -1.0, 1.36), 0.09, 0.0, 0.24, "#60ff80", seg=4)          # groene totemkristal
    b.kegel((0.3, -1.0, 1.28), 0.12, 0.09, 0.06, "#4a3424", seg=6)

# ── Koning: koninklijke mantel met hermelijn, gouden kroon, baard, scepter ──
def koning(b):
    lichaam(b, "#8a1030", "#3a0a1a")
    b.kegel((0, 0.06, 1.3), 0.5, 0.33, 1.0, "#6a0a28", seg=8)              # mantel
    b.kegel((0, 0.02, 1.8), 0.4, 0.3, 0.12, "#f4f0ea", seg=8)              # hermelijn
    for i in range(8):
        a = i / 8 * math.tau; b.blok((math.sin(a) * 0.36, math.cos(a) * 0.36 + 0.02, 1.8), (0.03, 0.03, 0.06), DONKER)
    baard(b, "#6a3a1a", 0.3)
    b.kegel((0, 0.0, 2.24), 0.21, 0.23, 0.14, "#f0c040", seg=8)            # kroon
    for i in range(6):
        a = i / 6 * math.tau
        b.kegel((math.sin(a) * 0.2, math.cos(a) * 0.2, 2.38), 0.045, 0.0, 0.16, "#f0c040", seg=4)
        b.ico((math.sin(a) * 0.225, math.cos(a) * 0.225, 2.25), 0.025, ["#e02040", "#2060e0", "#20c060"][i % 3], sub=0)
def koning_v(b):
    b.staaf((0.42, -0.7, 1.32), (0.5, -0.45, 2.3), 0.035, "#f0c040", seg=5)
    b.ico((0.5, -0.45, 2.36), 0.07, "#ffe080", sub=0)

rol("archmage", archmage, archmage_v, "#8060ff")
rol("engineer", engineer, engineer_v, "#20a0ff")
rol("guardian_keeper", guardian, guardian_v, "#3080ff")
rol("historian", historian, historian_v, "#ffd080")
rol("oracle", oracle, oracle_v, "#ff40c0")
rol("beast_master", beast, beast_v, "#40ff60")
rol("koning", koning, koning_v, "#ffc040", schaal=1.15)

bpy.ops.export_scene.gltf(filepath=UIT, export_format="GLB", export_yup=True, export_apply=False,
                          export_vertex_color="NAME", export_vertex_color_name="Kleur", export_all_vertex_colors=True, export_materials="EXPORT",
                          export_cameras=False, export_lights=False)
tellen = {o.name: len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH"}
print("EXPORT OK", UIT, sum(tellen.values()), "vlakken", tellen)
