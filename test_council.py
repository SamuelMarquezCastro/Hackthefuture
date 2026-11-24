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


def onderzoekskeuze(rol="engineer", doel="ingreep"):
    onderzoek = council.leeg_onderzoek()
    for d, stand in onderzoek.items():
        stand.update(volgende_vraag=f"Welke bevinding helpt bij {d}?", rol=rol)
    return {"rol": rol, "vraag": "Welke waarneming kan een oorzaak toetsen?",
            "reden": "We missen een onafhankelijk perspectief.", "doel": doel,
            "open_vragen": ["Welk mechanisme verklaart de symptomen?"],
            "onderzoek": onderzoek, "geschillen": []}


def afgerond_onderzoek():
    rollen = ["engineer", "oracle", "historian"]
    beurten = []
    onderzoek = council.leeg_onderzoek()
    keuzes = []
    for i, doel in enumerate(council.DOELEN):
        rol = rollen[i % len(rollen)]
        keuze = onderzoekskeuze(rol, doel)
        for d in council.DOELEN:
            if onderzoek[d]["status"] == "onderbouwd":
                keuze["onderzoek"][d] = dict(onderzoek[d])
        keuzes.append(keuze)
        beurten.append({"soort": "routering", "spreker": "koning", "aan": rol, "doel": doel, "nr": len(beurten)+1})
        bewijs = council.PREFIX_PER_ROL[rol] + "-" + "001"
        beurten.append({"soort": "bericht", "spreker": rol, "tekst": f"Eigen waarneming: {bewijs}",
                       "nr": len(beurten)+1})
        onderzoek[doel] = {"status": "onderbouwd", "samenvatting": "Getoetste hypothese.", "bewijs": [bewijs],
                           "volgende_vraag": None, "rol": None, "blokkade": None}
    stop = {"rol": None, "vraag": None, "reden": "De vijf doelen zijn behandeld en onderbouwd.",
            "doel": None, "open_vragen": [], "onderzoek": onderzoek, "geschillen": []}
    keuzes.append(stop)
    return beurten, keuzes


class RouteringTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.rollen = ["engineer", "oracle", "historian"]
        self.leden = [SimpleNamespace(ROL=r, PERSPECTIEF=f"Perspectief van {r}") for r in self.rollen]
        self.keuze = onderzoekskeuze()

    def response(self, keuze):
        return SimpleNamespace(text=json.dumps(keuze), usage_details={"input_token_count": 10})

    def test_json_met_codeblok_en_inleiding(self):
        self.assertEqual(lees_json("Hier is de keuze:\n```json\n" + json.dumps(self.keuze) + "\n```"), self.keuze)
        with self.assertRaises(ValueError):
            lees_json("Geen JSON")

    def test_verkeerd_ge_escapete_quotes_blijven_in_het_buitenste_object(self):
        payload = {"antwoord": 'Een "letterlijk citaat" blijft behouden.',
                   "bronverwijzingen": [{"id": "ENG-" + "001", "citaat": 'Een "letterlijk citaat".'}]}
        ongeldig = json.dumps(payload).replace(r'\"', r'\\"')
        self.assertEqual(lees_json(ongeldig), payload)

    def test_onbekende_rol_en_lege_vraag_worden_geweigerd(self):
        with self.assertRaises(ValidationError):
            controleer_routering({**self.keuze, "rol": "onbekend"}, self.rollen, [])
        for vraag in (None, "   "):
            with self.assertRaises(ValueError):
                controleer_routering({**self.keuze, "vraag": vraag}, self.rollen, [])

    def test_stop_vereist_verschillende_perspectieven(self):
        beurten, keuzes = afgerond_onderzoek()
        stop = keuzes[-1]
        with self.assertRaises(ValueError):
            controleer_routering(stop, self.rollen, ["oracle", "oracle", "engineer"], beurten)
        self.assertEqual(controleer_routering(stop, self.rollen, self.rollen, beurten), stop)

    def test_regressie_stoppen_met_uitvoerbare_mechanismevraag_wordt_geweigerd(self):
        beurten, keuzes = afgerond_onderzoek()
        stop = keuzes[-1]
        stop["onderzoek"]["mechanisme"] = self.keuze["onderzoek"]["mechanisme"]
        with self.assertRaisesRegex(ValueError, "Stoppen is voorbarig"):
            controleer_routering(stop, self.rollen, self.rollen, beurten)

    def test_onbeslist_kan_ook_steunen_op_antwoorden_met_een_ander_doellabel(self):
        beurten, keuzes = afgerond_onderzoek()
        stop = keuzes[-1]
        stop["onderzoek"]["mechanisme"].update(status="onbeslist", blokkade="Niet vast te stellen.")
        self.assertEqual(controleer_routering(stop, self.rollen, self.rollen, beurten), stop)
        beurten.extend([
            {"soort": "routering", "spreker": "koning", "aan": "historian", "doel": "mechanisme"},
            {"soort": "bericht", "spreker": "historian", "tekst": "Dit mechanisme kan ik niet vaststellen."},
        ])
        self.assertEqual(controleer_routering(stop, self.rollen, self.rollen, beurten), stop)

    def test_doelverdeling_reserveert_ruime_voor_ontbrekende_onderwerpen(self):
        beurten = []
        for _ in range(6):
            beurten.extend([
                {"soort": "routering", "spreker": "koning", "aan": "engineer", "doel": "ingreep"},
                {"soort": "bericht", "spreker": "engineer", "tekst": "Nog een tijdlijnwaarneming."},
            ])
        kandidaat = {**self.keuze, "rol": "oracle"}
        with self.assertRaisesRegex(ValueError, "nog niet behandeld doel"):
            controleer_routering(kandidaat, self.rollen, ["engineer"] * 6, beurten)
        keuze = {**kandidaat, "doel": "mechanisme"}
        self.assertEqual(controleer_routering(keuze, self.rollen, ["engineer"] * 6, beurten), keuze)

    def test_router_mag_geen_bewijs_uit_het_niets_toevoegen(self):
        self.keuze["onderzoek"]["ingreep"]["bewijs"] = ["ENG-" + "999"]
        with self.assertRaisesRegex(ValueError, "eigen Rol"):
            controleer_routering(self.keuze, self.rollen, [])

    def test_geen_derde_vergelijkbare_vraag_aan_dezelfde_rol(self):
        beurten = []
        for _ in range(2):
            beurten.extend([
                {"soort": "routering", "spreker": "koning", "aan": "engineer", "doel": "ingreep"},
                {"soort": "bericht", "spreker": "engineer", "tekst": "Mijn bron heeft geen aanvullende tijdmeting."},
            ])
        with self.assertRaisesRegex(ValueError, "al twee vragen"):
            controleer_routering(self.keuze, self.rollen, ["engineer"] * 2, beurten)
        keuze = {**self.keuze, "doel": "herstel"}
        gehoord = ["engineer", "engineer", "oracle", "historian"]
        self.assertEqual(controleer_routering(keuze, self.rollen, gehoord, beurten), keuze)

    def test_verzadigd_doel_wordt_gemeld_als_stopvoorwaarde(self):
        beurten = []
        for rol in ("engineer", "oracle"):
            beurten.extend([{"soort": "routering", "spreker": "koning", "aan": rol, "doel": "ingreep"},
                            {"soort": "bericht", "spreker": rol, "tekst": "Eigen waarneming."}])
        onderzoek = council.leeg_onderzoek()
        onderzoek["ingreep"].update(rol="engineer", volgende_vraag="Nog een detail?")
        self.assertEqual(council.verzadigde_doelen(onderzoek, beurten), ["ingreep"])
        onderzoek["ingreep"].update(rol="historian")
        self.assertEqual(council.verzadigde_doelen(onderzoek, beurten), [])
        onderzoek["ingreep"].update(status="onbeslist", rol=None, volgende_vraag=None, blokkade="Geen naam in de bronnen.")
        self.assertEqual(council.verzadigde_doelen(onderzoek, beurten), [])

    def test_zelf_stoppen_wacht_op_een_toetsbeurt_voor_een_open_geschil(self):
        beurten, keuzes = afgerond_onderzoek()
        stop = keuzes[-1]
        geschil = {"onderwerp": "Klokfout of registerfout", "standpunten": {"engineer": "Klok.", "historian": "Register."},
                   "uitkomst": None, "bewijs": []}
        stop["geschillen"] = [geschil]
        with self.assertRaisesRegex(ValueError, "toetsbeurt"):
            controleer_routering(stop, self.rollen, self.rollen, beurten)
        beurten.extend([{"soort": "routering", "spreker": "koning", "aan": "oracle", "doel": "mechanisme", "geschillen": [geschil]},
                        {"soort": "bericht", "spreker": "oracle", "tekst": "Mijn bron toont het tijdstip."}])
        self.assertEqual(controleer_routering(stop, self.rollen, self.rollen, beurten), stop)

    def test_nieuwe_perspectieven_gaan_voor_een_derde_beurt(self):
        keuze = {**self.keuze, "doel": "herstel"}
        with self.assertRaisesRegex(ValueError, "nog niet gesproken perspectief"):
            controleer_routering(keuze, self.rollen, ["engineer", "engineer"])

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

    async def test_budget_stopt_en_verwerkt_ook_de_laatste_getuigenis(self):
        stop = {**self.keuze, "rol": None, "vraag": None, "doel": None, "open_vragen": ["Nieuwe onzekerheid"]}
        koning = SimpleNamespace(run=AsyncMock(return_value=self.response(stop)))
        beurten = [{"soort": "routering", "spreker": "koning", "aan": "engineer", "open_vragen": ["Oude vraag"]}]
        beurten += [{"soort": "bericht", "spreker": self.rollen[i % 3], "tekst": "Getuigenis"} for i in range(10)]
        beurten[-1]["tekst"] = "LAATSTE GETUIGENIS"
        keuze = await kies_volgende(beurten, self.leden, koning, None, {})
        self.assertIsNone(keuze["rol"])
        self.assertEqual(keuze["open_vragen"], ["Nieuwe onzekerheid"])
        self.assertIn("Beurtenbudget op", keuze["reden"])
        self.assertIn("LAATSTE GETUIGENIS", koning.run.call_args.args[0])

    def test_budget_staat_geen_elfde_spreekbeurt_toe(self):
        with self.assertRaisesRegex(ValueError, "beurtenbudget is op"):
            controleer_routering(self.keuze, self.rollen, self.rollen * 3 + ["engineer"])

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
        self.assertNotIn("antwoord_schema", json.loads(prompt))

    async def test_verdict_is_onafhankelijk_van_routerconclusies(self):
        fixture = VerdictTests()
        fixture.setUp()
        koning = SimpleNamespace(run=AsyncMock(return_value=self.response(fixture.rapport)))
        beurten = [*fixture.beurten,
                   {"soort": "routering", "spreker": "koning", "onderzoek": "ONDERZOEK_IS_GEEN_BEWIJS"}]
        await council.maak_verdict(beurten, koning, None, {}, "test-run")
        self.assertNotIn("ONDERZOEK_IS_GEEN_BEWIJS", koning.run.call_args.args[0])


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
                "oorzaak": {naam: {"bewering": None, "bewijs": [], "zekerheid": 0, "redenering": "Dit deel is nog onbekend."}
                            for naam in ("ingreep", "mechanisme", "verloop")},
                "acties": [{"actie": "Verzamel onafhankelijk bewijs.", "reden": "De oorzaak is onzeker.", "succescriterium": "Een onafhankelijk getoetste verklaring."}],
                "risicos": [{"risico": "Overhaast ingrijpen.", "mitigatie": "Toets eerst de hypothese."}],
            },
            "geschillen": [],
        }

    def test_andermans_id_herhalen_maakt_het_geen_eigen_bewijs(self):
        self.assertEqual(bewijscatalogus(self.beurten), {self.eigen_id: "engineer"})
        self.rapport["verdict"]["oorzaak"]["ingreep"] = {
            "bewering": "Een hypothese", "bewijs": [self.vreemd_id], "zekerheid": 0.5, "redenering": "Een te toetsen afleiding."}
        with self.assertRaisesRegex(ValueError, "eigen Rol"):
            controleer_eindrapport(self.rapport, self.beurten, "test-run")

    def test_verdict_krijgt_juiste_run_id_en_normaliseert_zonder_trace_te_wijzigen(self):
        origineel = json.dumps(self.beurten)
        self.rapport["verdict"]["oorzaak"]["ingreep"] = {
            "bewering": "Een hypothese", "bewijs": [self.eigen_id.replace("-", "\u2011")], "zekerheid": 0.5, "redenering": "Een te toetsen afleiding."}
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

    def test_geen_standpunt_is_geen_geschil(self):
        self.beurten.append({"soort": "bericht", "spreker": "oracle", "tekst": "Ik kan die andere bron niet lezen."})
        self.rapport["geschillen"] = [{"onderwerp": "Toegang tot de bron",
                                      "standpunten": {"engineer": "Mijn bron bevat een waarneming.",
                                                      "oracle": "Geen standpunt; ik kan de bron niet lezen."},
                                      "uitkomst": None, "bewijs": []}]
        with self.assertRaisesRegex(ValueError, "geen botsend standpunt"):
            controleer_eindrapport(self.rapport, self.beurten, "test-run")

    def test_een_enkel_standpunt_is_geen_geschil(self):
        self.rapport["geschillen"] = [{"onderwerp": "Een interpretatie",
                                      "standpunten": {"engineer": "Mijn verklaring is onzeker."},
                                      "uitkomst": None, "bewijs": []}]
        with self.assertRaisesRegex(ValueError, "minstens twee"):
            controleer_eindrapport(self.rapport, self.beurten, "test-run")

    def test_herstelactie_vereist_een_succescriterium(self):
        self.rapport["verdict"]["acties"][0].pop("succescriterium")
        with self.assertRaises(ValidationError):
            controleer_eindrapport(self.rapport, self.beurten, "test-run")

    def test_voorspelling_moet_rekenkundig_kloppen(self):
        self.rapport["verdict"]["voorspelling"] = {
            "dag": 12, "laatste_waargenomen_dag": 9, "interval_dagen": 2,
            "bewering": "De waargenomen periode blijft mogelijk bestaan.", "bewijs": [self.eigen_id]}
        with self.assertRaisesRegex(ValueError, "laatste_waargenomen_dag"):
            controleer_eindrapport(self.rapport, self.beurten, "test-run")
        self.rapport["verdict"]["voorspelling"]["dag"] = 11
        resultaat = controleer_eindrapport(self.rapport, self.beurten, "test-run")
        self.assertEqual(resultaat["verdict"]["voorspelling"]["dag"], 11)


class VolledigeRunTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_schrijft_geldig_verdict_en_ongewijzigde_getuigenissen(self):
        rollen = ["engineer", "oracle", "historian"]
        leden = [SimpleNamespace(ROL=r, NAAM=r, PERSPECTIEF=f"Perspectief {r}") for r in rollen]
        stemmen = {r: f"Eigen waarneming: {council.PREFIX_PER_ROL[r]}-" + "001" for r in rollen}
        _, keuzes = afgerond_onderzoek()
        rapport = VerdictTests()
        rapport.setUp()

        def response(tekst):
            return SimpleNamespace(text=tekst, usage_details={}, messages=[])

        def agent_factory(*args, name, **kwargs):
            if name == "koning_router":
                return SimpleNamespace(run=AsyncMock(side_effect=[response(json.dumps(k)) for k in keuzes]))
            if name == "koning":
                return SimpleNamespace(run=AsyncMock(return_value=response(json.dumps(rapport.rapport))))
            bewijs = council.PREFIX_PER_ROL[name] + "-" + "001"
            antwoord = {"antwoord": stemmen[name], "bronverwijzingen": [{"id": bewijs, "citaat": stemmen[name]}]}
            return SimpleNamespace(run=AsyncMock(return_value=response(json.dumps(antwoord))))

        with tempfile.TemporaryDirectory() as tijdelijke_map:
            root = Path(tijdelijke_map)
            shutil.copytree(council.ROOT / "schema", root / "schema")
            for r in rollen:
                bron = root / "kennisbronnen" / r
                bron.mkdir(parents=True)
                bewijs = council.PREFIX_PER_ROL[r] + "-" + "001"
                (bron / "test.md").write_text(f"[{bewijs}]\n{stemmen[r]}", encoding="utf-8")
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
            self.assertEqual({r: tekst.split("\n\nBroncitaten:\n")[0] for r, tekst in berichten.items()}, stemmen)
            self.assertTrue(all(b.get("citaatcontrole") == "geslaagd" for b in trace["beurten"]
                                if b["soort"] == "bericht" and b["spreker"] in rollen))
            self.assertEqual({b["spreker"] for b in trace["beurten"] if b["soort"] == "bestand"}, set(rollen))


if __name__ == "__main__":
    unittest.main()
