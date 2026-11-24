"""Eindcontrole op synthetische runs, zonder netwerk of challengefeiten."""
import json
import tempfile
import unittest
from pathlib import Path

import audit
import council


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.tijdelijk = tempfile.TemporaryDirectory()
        self.addCleanup(self.tijdelijk.cleanup)
        self.root = Path(self.tijdelijk.name)
        rollen = ["engineer", "oracle", "historian"]
        self.trace = {"run_id": "test-run", "status": "klaar", "raadsleden": rollen,
                      "beurten": [], "geschillen": [], "verbruik": {}}
        for rol in rollen:
            bewijs = council.PREFIX_PER_ROL[rol] + "-" + "001"
            bron = self.root / "kennisbronnen" / rol
            bron.mkdir(parents=True)
            (bron / "test.md").write_text(f"[{bewijs}] Een synthetische waarneming.")
            self.beurt("koning", "routering", aan=rol, vraag="Wat weet je?", reden="Testperspectief.", open_vragen=[])
            self.beurt(rol, "toolcall", tool="lees_kennisbron", argumenten={}, pad=f"https://example.invalid/{rol}/mcp")
            self.beurt(rol, "bericht", tekst=f"Een waarneming: {bewijs}")
        self.beurt("koning", "routering", aan=None, vraag=None, reden="Onderzoek afgerond.", open_vragen=[])
        self.verdict = {
            "run_id": "test-run", "samenvatting": "Een synthetische run met onbekende oorzaak.",
            "oorzaak": {d: {"bewering": None, "bewijs": [], "zekerheid": 0,
                            "redenering": "Nog niet bekend."} for d in ("ingreep", "mechanisme", "verloop")},
            "acties": [{"actie": "Controleer de hypothese.", "reden": "Onzekerheid verminderen.",
                        "succescriterium": "Een onafhankelijk getoetste verklaring."}],
            "risicos": [{"risico": "Een onjuiste conclusie.", "mitigatie": "Toets tegenbewijs."}],
        }

    def beurt(self, rol, soort, **velden):
        self.trace["beurten"].append({"nr": len(self.trace["beurten"]) + 1, "ronde": 1,
                                      "spreker": rol, "soort": soort, **velden})

    def controleer(self):
        for naam, data in (("trace.json", self.trace), ("verdict.json", self.verdict)):
            (self.root / naam).write_text(json.dumps(data))
        return audit.controleer(self.root)

    def test_geldige_run_en_bronindex_worden_herkend_zonder_mutatie(self):
        rapport = self.controleer()
        origineel = (self.root / "trace.json").read_bytes()
        self.assertEqual(rapport["fouten"], [])
        self.assertTrue(rapport["bronindex_volledig"])
        self.assertEqual(rapport["raadsleden_beurten"], 3)
        audit.controleer(self.root)
        self.assertEqual((self.root / "trace.json").read_bytes(), origineel)

    def test_verzonnen_bron_id_wordt_afgekeurd(self):
        self.trace["beurten"][2]["tekst"] += " ENG-" + "999"
        self.assertTrue(any("niet-bestaande eigen" in f for f in self.controleer()["fouten"]))

    def test_mcp_van_andere_rol_wordt_afgekeurd(self):
        self.trace["beurten"][1]["pad"] = "https://example.invalid/oracle/mcp"
        self.assertTrue(any("MCP-pad" in f for f in self.controleer()["fouten"]))

    def test_koning_mag_geen_bron_lezen(self):
        self.beurt("koning", "toolcall", tool="lees_kennisbron", argumenten={},
                   pad="https://example.invalid/engineer/mcp")
        self.assertTrue(any("bronlezing door koning" in f for f in self.controleer()["fouten"]))

    def test_onvoltooide_run_wordt_afgekeurd(self):
        self.trace["status"] = "bezig"
        self.assertTrue(any("niet succesvol afgerond" in f for f in self.controleer()["fouten"]))


if __name__ == "__main__":
    unittest.main()
