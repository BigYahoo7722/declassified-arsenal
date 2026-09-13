"""Offline sanity check for extractor_bot.py's pure-function pipeline.
Runs no network calls: parse_infobox / normalize_specs / classify_domain /
bucket_era / slugify / generate_laymans_brief(fallback path)."""

from extractor_bot import (
    parse_infobox, normalize_specs, classify_domain, extract_year,
    bucket_era, slugify, guess_nation, generate_laymans_brief, make_session,
)

SAMPLE_HTML = """
<table class="infobox vevent">
  <tr><th colspan="2">M1 Abrams</th></tr>
  <tr><th>Type</th><td>Main battle tank</td></tr>
  <tr><th>Manufacturer</th><td>General Dynamics Land Systems</td></tr>
  <tr><th>Crew</th><td>4 (commander, gunner, loader, driver)[1]</td></tr>
  <tr><th>Mass</th><td>~68 tons</td></tr>
  <tr><th>Maximum speed</th><td>67 km/h  (road)</td></tr>
  <tr><th>In service</th><td>1980–present</td></tr>
</table>
"""

raw = parse_infobox(SAMPLE_HTML)
print("raw infobox:", raw)
assert raw["Crew"] == "4 (commander, gunner, loader, driver)", "footnote stripping failed"
assert raw["Mass"] == "~68 tons"

specs = normalize_specs(raw)
print("normalized specs:", specs)
assert specs["crew"] == "4 (commander, gunner, loader, driver)"
assert specs["combatWeight"] == "~68 tons"
assert specs["maxSpeed"] == "67 km/h (road)"

year = extract_year(raw)
print("extracted year:", year)
assert year == 1980

era = bucket_era(year)
print("era bucket:", era)
assert era == "Cold War"

domain = classify_domain(["Tanks of the United States", "Cold War weapons"])
print("domain:", domain)
assert domain == "Land"

nation = guess_nation(["Tanks of the United States"], "M1 Abrams")
print("nation:", nation)
assert nation == "United States"

slug = slugify(nation, "M1 Abrams")
print("slug:", slug)
assert slug == "us-m1-abrams"

# Fallback brief path (no ANTHROPIC_API_KEY set in this sandbox) must never raise.
vehicle = {
    "name": "M1 Abrams", "designation": "Main battle tank", "role": "Main battle tank",
    "nation": "United States", "yearIntroduced": 1980, "specs": specs,
}
session = make_session()
brief = generate_laymans_brief(session, vehicle, "summary text", use_llm=True, provider="anthropic", model="claude-sonnet-5")
print("fallback brief:", brief)
assert "M1 Abrams" in brief

print("\nALL OFFLINE CHECKS PASSED")
