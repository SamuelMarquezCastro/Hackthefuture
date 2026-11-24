"""Controleer de routering zonder API-verbruik: python -m unittest -v."""
import json
import io
import os
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from jsonschema import ValidationError

import council
from validate import spelregels
from council import bewijscatalogus, controleer_eindrapport, controleer_routering, kies_volgende, lees_json


class RouteringTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.rollen = ["engineer", "oracle", "historian"]
        self.leden = [SimpleNamespace(ROL=r, PERSPECTIEF=f"Perspectief van {r}") for r in self.rollen]
        self.keuze = {"rol": "engineer", "vraag": "Welke waarneming kan een oorzaak toetsen?",
                      "reden": "We missen een onafhankelijk perspectief.",
                      "open_vragen": ["Welk mechanisme verklaart de symptomen?"]}

    def response(self, keuze):
        return SimpleNamespace(text=json.dumps(keuze), usage_details={"input_token_count": 10})

    def test_json_met_codeblok_en_inleiding(self):
        self.assertEqual(lees_json("Hier is de keuze:\n```json\n" + json.dumps(self.keuze) + "\n```"), self.keuze)
        with self.assertRaises(ValueError):
            lees_json("Geen JSON")

    def test_onbekende_rol_en_lege_vraag_worden_geweigerd(self):
        with self.assertRaises(ValidationError):
            controleer_routering({**self.keuze, "rol": "onbekend"}, self.rollen, [])
        for vraag in (None, "   "):
            with self.assertRaises(ValueError):
                controleer_routering({**self.keuze, "vraag": vraag}, self.rollen, [])

    def test_stop_vereist_verschillende_perspectieven(self):
        stop = {**self.keuze, "rol": None, "vraag": None}
        with self.assertRaises(ValueError):
            controleer_routering(stop, self.rollen, ["oracle", "oracle", "engineer"])
        self.assertEqual(controleer_routering(stop, self.rollen, self.rollen), stop)

    async def test_ongeldige_keuze_wordt_hersteld_en_verbruik_geteld(self):
        koning = SimpleNamespace(run=AsyncMock(side_effect=[
            self.response({**self.keuze, "rol": "onbekend"}), self.response(self.keuze)]))
        verbruik = {}
        keuze = await kies_volgende([], self.leden, koning, None, verbruik)
        self.assertEqual(keuze, self.keuze)
        self.assertEqual(koning.run.await_count, 2)
        self.assertEqual(verbruik["groot"]["beurten"], 2)

    async def test_tweede_ongeldige_keuze_stopt_met_fout(self):
        koning = SimpleNamespace(run=AsyncMock(return_value=self.response({**self.keuze, "rol": "onbekend"})))
        with self.assertRaises(ValueError):
            await kies_volgende([], self.leden, koning, None, {})
        self.assertEqual(koning.run.await_count, 2)

    async def test_budget_stopt_zonder_modelcall_en_bewaart_open_vragen(self):
        koning = SimpleNamespace(run=AsyncMock())
        beurten = [{"soort": "routering", "open_vragen": ["Onbeantwoord"]}]
        beurten += [{"soort": "bericht", "spreker": self.rollen[i % 3], "tekst": "Getuigenis"} for i in range(10)]
        keuze = await kies_volgende(beurten, self.leden, koning, None, {})
        self.assertIsNone(keuze["rol"])
        self.assertEqual(keuze["open_vragen"], ["Onbeantwoord"])
        koning.run.assert_not_awaited()

    async def test_koning_krijgt_geen_toolinhoud_of_eerdere_eindsamenvatting(self):
        koning = SimpleNamespace(run=AsyncMock(return_value=self.response(self.keuze)))
        beurten = [
            {"soort": "toolcall", "spreker": "oracle", "tekst": "GEHEIME TOOLINHOUD"},
            {"soort": "bericht", "spreker": "koning", "tekst": "OUDE SAMENVATTING"},
            {"soort": "bericht", "spreker": "oracle", "tekst": "Publieke getuigenis"},
        ]
        await kies_volgende(beurten, self.leden, koning, None, {})
        prompt = koning.run.call_args.args[0]
        self.assertNotIn("GEHEIME TOOLINHOUD", prompt)
        self.assertNotIn("OUDE SAMENVATTING", prompt)
        self.assertIn("Publieke getuigenis", prompt)


class VerdictTests(unittest.TestCase):
    def setUp(self):
        # Synthetische gegevens: geen feiten uit de challenge in tests of prompts.
        self.eigen_id = "ENG-" + "001"
        self.vreemd_id = "ORA-" + "002"
        self.beurten = [{"soort": "bericht", "spreker": "engineer",
                         "tekst": f"Eigen waarneming ({self.eigen_id}); ik herhaal {self.vreemd_id}."}]
        self.rapport = {
            "verdict": {
                "samenvatting": "Onvoldoende onafhankelijke bronnen voor een definitieve oorzaak.",
                "oorzaak": {naam: {"bewering": None, "bewijs": [], "zekerheid": 0}
                            for naam in ("ingreep", "mechanisme", "verloop")},
                "acties": [{"actie": "Verzamel onafhankelijk bewijs.", "reden": "De oorzaak is onzeker."}],
                "risicos": [{"risico": "Overhaast ingrijpen.", "mitigatie": "Toets eerst de hypothese."}],
            },
            "geschillen": [],
        }

    def test_andermans_id_herhalen_maakt_het_geen_eigen_bewijs(self):
        self.assertEqual(bewijscatalogus(self.beurten), {self.eigen_id: "engineer"})
        self.rapport["verdict"]["oorzaak"]["ingreep"] = {
            "bewering": "Een hypothese", "bewijs": [self.vreemd_id], "zekerheid": 0.5}
        with self.assertRaisesRegex(ValueError, "eigen Rol"):
            controleer_eindrapport(self.rapport, self.beurten, "test-run")

    def test_verdict_krijgt_juiste_run_id_en_normaliseert_zonder_trace_te_wijzigen(self):
        origineel = json.dumps(self.beurten)
        self.rapport["verdict"]["oorzaak"]["ingreep"] = {
            "bewering": "Een hypothese", "bewijs": [self.eigen_id.replace("-", "\u2011")], "zekerheid": 0.5}
        resultaat = controleer_eindrapport(self.rapport, self.beurten, "test-run")
        self.assertEqual(resultaat["verdict"]["run_id"], "test-run")
        self.assertEqual(resultaat["verdict"]["oorzaak"]["ingreep"]["bewijs"], [self.eigen_id])
        self.assertEqual(json.dumps(self.beurten), origineel)

    def test_onbekend_oorzaakdeel_heeft_geen_schijnzekerheid(self):
        self.rapport["verdict"]["oorzaak"]["ingreep"]["zekerheid"] = 0.8
        with self.assertRaisesRegex(ValueError, "onbekend oorzaakdeel"):
            controleer_eindrapport(self.rapport, self.beurten, "test-run")

    def test_geen_standpunten_toeschrijven_aan_afwezige_rollen(self):
        self.rapport["geschillen"] = [{"onderwerp": "Hypothese", "standpunten": {"oracle": "Oneens"},
                                      "uitkomst": None, "bewijs": []}]
        with self.assertRaisesRegex(ValueError, "niet sprak"):
            controleer_eindrapport(self.rapport, self.beurten, "test-run")

    def test_schema_eist_bewijs_bij_een_bewering(self):
        self.rapport["verdict"]["oorzaak"]["ingreep"] = {
            "bewering": "Onbewezen claim", "bewijs": []}
        with self.assertRaises(ValidationError):
            controleer_eindrapport(self.rapport, self.beurten, "test-run")


class VolledigeRunTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_schrijft_geldig_verdict_en_ongewijzigde_getuigenissen(self):
        rollen = ["engineer", "oracle", "historian"]
        leden = [SimpleNamespace(ROL=r, NAAM=r, PERSPECTIEF=f"Perspectief {r}") for r in rollen]
        stemmen = {r: f"Eigen waarneming: {council.PREFIX_PER_ROL[r]}-" + "001" for r in rollen}
        keuzes = [{"rol": r, "vraag": "Welke eigen waarneming is relevant?", "reden": "Ontbrekend perspectief.",
                   "open_vragen": ["Wat is de oorzaak?"]} for r in rollen]
        keuzes.append({"rol": None, "vraag": None, "reden": "Verdere beurten leveren nu geen nieuw bewijs.",
                       "open_vragen": ["Wat is de oorzaak?"]})
        rapport = VerdictTests()
        rapport.setUp()

        def response(tekst):
            return SimpleNamespace(text=tekst, usage_details={}, messages=[])

        def agent_factory(*args, name, **kwargs):
            if name == "koning_router":
                return SimpleNamespace(run=AsyncMock(side_effect=[response(json.dumps(k)) for k in keuzes]))
            if name == "koning":
                return SimpleNamespace(run=AsyncMock(return_value=response(json.dumps(rapport.rapport))))
            return SimpleNamespace(run=AsyncMock(return_value=response(stemmen[name])))

        with tempfile.TemporaryDirectory() as tijdelijke_map:
            root = Path(tijdelijke_map)
            shutil.copytree(council.ROOT / "schema", root / "schema")
            for r in rollen:
                bron = root / "kennisbronnen" / r
                bron.mkdir(parents=True)
                (bron / "test.md").write_text(stemmen[r], encoding="utf-8")
            env = {"OPENAI_BASE_URL": "https://example.invalid/v1", "OPENAI_API_KEY": "test",
                   "MODEL_KLEIN": "test", "MODEL_GROOT": "test", **{f"MCP_{r.upper()}": "" for r in council.ROLLEN}}
            with patch.object(council, "ROOT", root), patch.object(council, "KENNISBRONNEN", root / "kennisbronnen"), \
                    patch.object(council.raadsleden, "alle", return_value=leden), \
                    patch.object(council, "client", return_value=None), \
                    patch.object(council, "Agent", side_effect=agent_factory), \
                    patch.dict(os.environ, env), redirect_stdout(io.StringIO()):
                await council.run()
            trace = json.loads((root / "trace.json").read_text())
            verdict = json.loads((root / "verdict.json").read_text())
            self.assertEqual(trace["status"], "klaar")
            self.assertEqual(trace["run_id"], verdict["run_id"])
            self.assertEqual(spelregels(trace), [])
            berichten = {b["spreker"]: b["tekst"] for b in trace["beurten"]
                         if b["soort"] == "bericht" and b["spreker"] in rollen}
            self.assertEqual(berichten, stemmen)
            self.assertEqual({b["spreker"] for b in trace["beurten"] if b["soort"] == "bestand"}, set(rollen))


if __name__ == "__main__":
    unittest.main()
