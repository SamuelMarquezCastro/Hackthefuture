"""Onafhankelijke eindcontrole, zonder API-aanvragen of wijzigingen aan de run.

Gebruik: uv run python audit.py [--json]
Het bronpakket wordt alleen door deze controle gelezen, nooit door de Koning.
ID-bestaan en herkomst zijn controleerbaar; inhoudelijke gevolgtrekkingen vragen review.
"""
import json
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

from jsonschema import Draft202012Validator, ValidationError

import council
from validate import spelregels

ROOT = Path(__file__).parent


def controleer(root=ROOT):
    root = Path(root)
    fouten, waarschuwingen = [], []
    rapport = {"fouten": fouten, "waarschuwingen": waarschuwingen}
    data = {}
    for naam in ("trace.json", "verdict.json"):
        try:
            data[naam] = json.loads((root / naam).read_text(encoding="utf-8"))
            schema = json.loads((ROOT / "schema" / naam).read_text(encoding="utf-8"))
            fouten.extend(f"{naam}: {e.message}" for e in Draft202012Validator(schema).iter_errors(data[naam]))
        except (OSError, ValueError) as exc:
            fouten.append(f"{naam}: {exc}")
    if fouten:
        return rapport
    trace, verdict = data["trace.json"], data["verdict.json"]
    beurten = trace["beurten"]
    rapport["run_id"] = trace["run_id"]
    fouten.extend(spelregels(trace))
    if trace["run_id"] != verdict["run_id"]:
        fouten.append("Trace en verdict komen niet uit dezelfde run.")
    if trace.get("status") != "klaar":
        fouten.append("De run is niet succesvol afgerond.")
    rollen = trace["raadsleden"]
    if len(rollen) < 3:
        fouten.append("Minstens drie Rollen moeten geconfigureerd zijn.")
    berichten = [b for b in beurten if b["soort"] == "bericht" and b["spreker"] in council.ROLLEN]
    if len({b["spreker"] for b in berichten}) < 3:
        fouten.append("Minder dan drie verschillende Rollen hebben daadwerkelijk gesproken.")
    bestanden, broncalls, toewijzing = set(), set(), None
    for b in beurten:
        rol, soort = b["spreker"], b["soort"]
        if soort in ("toolcall", "bestand"):
            if rol not in rollen:
                fouten.append(f"Beurt {b['nr']}: bronlezing door {rol}, buiten de geconfigureerde Rollen.")
            elif soort == "toolcall":
                if urlparse(b["pad"]).path.rstrip("/") != f"/{rol}/mcp":
                    fouten.append(f"Beurt {b['nr']}: {rol} gebruikt een MCP-pad van een andere Rol.")
                if rol == toewijzing:
                    broncalls.add(rol)
            else:
                # Bestandsnamen in de fallback zijn relatief aan kennisbronnen/.
                pad = Path(b["bestand"])
                if pad.is_absolute() or ".." in pad.parts or not pad.parts or pad.parts[0] != rol:
                    fouten.append(f"Beurt {b['nr']}: {rol} leest een bestand buiten zijn eigen map.")
                else:
                    bestanden.add(rol)
        elif soort == "routering":
            toewijzing = b["aan"]
            broncalls.clear()
        elif soort == "bericht" and rol in council.ROLLEN:
            if rol not in rollen:
                fouten.append(f"Beurt {b['nr']}: een niet-geconfigureerde Rol spreekt.")
            if rol not in broncalls and rol not in bestanden:
                fouten.append(f"Beurt {b['nr']}: {rol} sprak zonder eigen bronlezing voor deze beurt.")
            toewijzing = None
            broncalls.clear()

    bron_ids = {rol: set() for rol in rollen}
    brontekst = {rol: "" for rol in rollen}
    for rol in rollen:
        for pad in (root / "kennisbronnen" / rol).glob("*"):
            if pad.suffix in (".md", ".csv"):
                tekst = council.normaliseer_ids(pad.read_text(encoding="utf-8-sig"))
                brontekst[rol] += "\n" + tekst
                bron_ids[rol].update(council.BEWIJS_ID.findall(tekst))
    volledige_bronindex = all(bron_ids.values())
    if not volledige_bronindex:
        waarschuwingen.append("Bronpakket ontbreekt voor minstens één Rol: ID-bestaan is niet volledig gecontroleerd.")
    else:
        for b in berichten:
            rol = b["spreker"]
            prefix = council.PREFIX_PER_ROL[rol] + "-"
            eigen_ids = {i for i in council.BEWIJS_ID.findall(council.normaliseer_ids(b["tekst"])) if i.startswith(prefix)}
            onbekend = eigen_ids - bron_ids.get(rol, set())
            if onbekend:
                fouten.append(f"Beurt {b['nr']}: niet-bestaande eigen bron-ID's: {', '.join(sorted(onbekend))}")
            if b.get("bronverwijzingen"):
                try:
                    origineel_antwoord = b.get("antwoord", b["tekst"].split("\n\nBroncitaten:\n")[0])
                    council.controleer_raadslid(json.dumps({"antwoord": origineel_antwoord, "bronverwijzingen": b["bronverwijzingen"]}),
                                              rol, brontekst.get(rol, ""))
                except (ValueError, ValidationError) as exc:
                    fouten.append(f"Beurt {b['nr']}: ongeldige broncitaten: {getattr(exc, 'message', str(exc))[:300]}")
        alle_ids = set().union(*bron_ids.values())
        gebruikt = set(council.BEWIJS_ID.findall(json.dumps(council.normaliseer_ids(verdict), ensure_ascii=False)))
        if gebruikt - alle_ids:
            fouten.append("Verdict citeert niet-bestaande bron-ID's: " + ", ".join(sorted(gebruikt - alle_ids)))
    if any(not b.get("bronverwijzingen") for b in berichten):
        waarschuwingen.append("Niet alle Raadslid-berichten hebben gecontroleerde letterlijke broncitaten.")
    try:
        council.controleer_eindrapport({"verdict": verdict, "geschillen": trace["geschillen"]}, beurten, trace["run_id"])
    except (ValueError, ValidationError) as exc:
        fouten.append("Teamcontrole eindrapport: " + getattr(exc, "message", str(exc))[:400])

    for doel in ("ingreep", "mechanisme", "verloop"):
        if verdict["oorzaak"][doel]["bewering"] is None:
            waarschuwingen.append(f"Oorzaakdeel {doel} blijft onbekend; inhoudelijk verbeterpunt.")
    if not trace["geschillen"]:
        waarschuwingen.append("Geen geschillen vastgelegd. Controleer of echte tegenstrijdigheden zijn onderzocht.")
    routeringen = [b for b in beurten if b["soort"] == "routering"]
    vroeg_gestopt = bool(routeringen and routeringen[-1]["aan"] is None and len(berichten) < council.BEURTENBUDGET)
    if not vroeg_gestopt:
        waarschuwingen.append("Niet zelfstandig gestopt vóór het beurtenbudget; extra uitdaging nog niet aangetoond.")
    if "voorspelling" not in verdict:
        waarschuwingen.append("Geen voorspelling opgenomen; extra uitdaging Verdict nog niet volledig benut.")
    rapport.update({
        "raadsleden_beurten": len(berichten), "gesproken_rollen": sorted({b["spreker"] for b in berichten}),
        "toolcalls": sum(b["soort"] == "toolcall" for b in beurten),
        "doelverdeling": dict(Counter(b.get("doel", "onbekend") for b in berichten)),
        "bronindex_volledig": volledige_bronindex,
        "tokens_totaal": sum(v.get("invoer", 0) + v.get("uitvoer", 0) for v in trace.get("verbruik", {}).values()),
        "extra": {"voorspelling": "voorspelling" in verdict,
                  "zekerheid": all("zekerheid" in verdict["oorzaak"][d] for d in ("ingreep", "mechanisme", "verloop")),
                  "open_vragen": bool(routeringen) and all(isinstance(b.get("open_vragen"), list) for b in routeringen),
                  "vroeg_gestopt": vroeg_gestopt},
        "beperking": "Deze controle bewijst ID-bestaan en herkomst, niet dat elke conclusie inhoudelijk klopt.",
    })
    return rapport


def main():
    rapport = controleer()
    if "--json" in sys.argv:
        print(json.dumps(rapport, ensure_ascii=False, indent=2))
    else:
        for fout in rapport["fouten"]:
            print("FOUT:", fout)
        for waarschuwing in rapport["waarschuwingen"]:
            print("REVIEW:", waarschuwing)
        print("EINDCONTROLE:", "GROEN" if not rapport["fouten"] else "ROOD")
        print(rapport.get("beperking", ""))
    sys.exit(bool(rapport["fouten"]))


if __name__ == "__main__":
    main()
