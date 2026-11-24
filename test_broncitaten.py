"""Letterlijke broncitaten controleren zonder challenge-inhoud of netwerk."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from agent_framework import Content, Message

import council


class BroncitaatTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.id = "ENG-" + "001"
        self.ander = "ENG-" + "002"
        self.bron = f"[{self.id}]\nDe instelling verandert het tempo.\n\n[{self.ander}]\nEen andere passage."
        self.antwoord = {"antwoord": f"Een controleerbare waarneming ({self.id}).",
                         "bronverwijzingen": [{"id": self.id, "citaat": "De instelling verandert het tempo."}]}

    def test_letterlijk_citaat_is_controleerbaar(self):
        resultaat = council.controleer_raadslid(json.dumps(self.antwoord), "engineer", self.bron)
        self.assertEqual(resultaat["antwoord"], self.antwoord["antwoord"])
        self.assertEqual(resultaat["bronverwijzingen"][0]["bronkop"], f"[{self.id}]")

    def test_negatie_toevoegen_aan_een_bestaand_record_wordt_geweigerd(self):
        self.antwoord["bronverwijzingen"][0]["citaat"] = "De instelling verandert het tempo niet."
        with self.assertRaisesRegex(ValueError, "Geen letterlijk citaat"):
            council.controleer_raadslid(json.dumps(self.antwoord), "engineer", self.bron)

    def test_citaat_moet_bij_het_juiste_record_horen(self):
        self.antwoord["bronverwijzingen"][0]["citaat"] = "Een andere passage."
        with self.assertRaisesRegex(ValueError, "Geen letterlijk citaat"):
            council.controleer_raadslid(json.dumps(self.antwoord), "engineer", self.bron)

    def test_elke_eigen_verwijzing_heeft_een_citaat(self):
        self.antwoord["antwoord"] += " Ook " + self.ander
        with self.assertRaisesRegex(ValueError, "Niet elk eigen"):
            council.controleer_raadslid(json.dumps(self.antwoord), "engineer", self.bron)

    def test_bronkop_wordt_uit_het_geselecteerde_record_gehaald(self):
        bron = f"{self.id},7,09:15,een synthetische waarneming\n"
        antwoord = {"antwoord": f"Een waarneming ({self.id}).",
                    "bronverwijzingen": [{"id": self.id, "citaat": "een synthetische waarneming"}]}
        resultaat = council.controleer_raadslid(json.dumps(antwoord), "engineer", bron)
        self.assertEqual(resultaat["bronverwijzingen"][0]["bronkop"], bron.strip())
        antwoord["bronverwijzingen"][0]["bronkop"] = "Een verzonnen tijdstip"
        with self.assertRaisesRegex(ValueError, "bronkop wijkt af"):
            council.controleer_raadslid(json.dumps(antwoord), "engineer", bron)

    async def test_citaatherstel_gebruikt_bestaande_toolrespons_zonder_nieuwe_bronlezing(self):
        fout = {**self.antwoord, "bronverwijzingen": [{"id": self.id, "citaat": "Een verzonnen passage."}]}
        berichten = [Message("assistant", [Content("function_call", call_id="test", name="lees_kennisbron", arguments={})]),
                     Message("tool", [Content.from_function_result("test", result=self.bron)])]
        response1 = SimpleNamespace(text=json.dumps(fout), messages=berichten, usage_details={"input_token_count": 10})
        response2 = SimpleNamespace(text=json.dumps(self.antwoord), messages=[], usage_details={"input_token_count": 10})
        agent = SimpleNamespace(run=AsyncMock(side_effect=[response1, response2]))
        calls = []
        tekst, verwijzingen, pogingen, antwoord = await council.raadslid_beurt(
            agent, SimpleNamespace(ROL="engineer"), "Een vraag", "https://example.invalid/engineer/mcp", [], None, {},
            lambda tool, args: calls.append(tool))
        self.assertEqual(calls, ["lees_kennisbron"])
        self.assertEqual(pogingen, 1)
        self.assertIn(self.antwoord["bronverwijzingen"][0]["citaat"], tekst)
        self.assertEqual(agent.run.call_args.kwargs["options"]["tool_choice"], "none")


if __name__ == "__main__":
    unittest.main()
