#!/usr/bin/env python3
"""
extractor_bot.py — DECLASSIFIED: ARSENAL data pipeline
========================================================================

Populates ../public/data/vehicles.json (consumed by DeclassifiedArsenal.jsx)
from public, open-source military-vehicle data on Wikipedia, then uses an
LLM to turn the raw infobox specs into a plain-language "Layman's Brief"
for each record.

DATA SOURCE & COMPLIANCE
-------------------------------------------------------------------------
This script only talks to the official MediaWiki Action API
(https://www.mediawiki.org/wiki/API:Main_page), not by scraping rendered
HTML off arbitrary URLs. That API is the sanctioned, documented way to
reuse Wikipedia content programmatically. Two things to keep in mind if
you build on this:

  1. Wikipedia's User-Agent policy requires a descriptive UA string that
     identifies your tool and gives a contact method — see
     https://meta.wikimedia.org/wiki/User-Agent_policy. Fill in
     CONTACT_INFO below before running this at any real volume.
  2. Wikipedia text is CC BY-SA / GFDL licensed. If vehicles.json (or
     anything derived from it) is republished outside an internal tool,
     you are responsible for satisfying that license's attribution terms
     for the fields pulled directly from Wikipedia (raw specs, summary).
     The laymansBrief field is LLM-generated from that material and
     should be reviewed the same way any AI-assisted paraphrase would be.

OUTPUT CONTRACT (must match the Vehicle schema in DeclassifiedArsenal.jsx)
-------------------------------------------------------------------------
    {
      "id":             str,   slug, e.g. "us-m1a2-abrams"
      "name":           str,
      "designation":    str,
      "nation":         str,
      "domain":         "Land" | "Air" | "Sea",
      "era":            str,   bucketed from yearIntroduced, see ERA_BOUNDARIES
      "yearIntroduced": int | null,
      "manufacturer":   str,
      "role":           str,
      "thumbnail":      str,   left "" — point this at your own image
                                pipeline; the frontend already falls back
                                to a hangar placeholder image when empty
      "laymansBrief":   str,
      "tags":           [str],
      "specs":          {str: str}
    }

USAGE (works from the repo root or from inside scripts/ — the output path
below is resolved relative to this file, not your current directory)
-------------------------------------------------------------------------
    # From a plain text file of Wikipedia page titles, one per line:
    python extractor_bot.py --input titles.txt

    # Crawl every page in a Wikipedia category (paginated automatically):
    python extractor_bot.py --category "Main battle tanks" --limit 500

    # Dry run without any LLM calls (uses a templated brief instead):
    python extractor_bot.py --input titles.txt --no-llm

    # Resume an interrupted run without refetching completed records:
    python extractor_bot.py --input titles.txt --resume

Requires: requests, beautifulsoup4
    pip install requests beautifulsoup4 --break-system-packages
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from bs4 import BeautifulSoup

# ============================================================================
# Configuration
# ============================================================================

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"

# Wikimedia's User-Agent policy requires a real contact point — update this
# before running the script at any real scale.
CONTACT_INFO = "https://example.com/contact (replace before real use)"
USER_AGENT = f"DeclassifiedArsenalBot/1.0 ({CONTACT_INFO})"

REQUEST_DELAY_SECONDS = 1.0   # baseline politeness delay between API calls
MAX_RETRIES = 3

# Year -> era bucket, used by bucket_era(). Keep this in sync with ERA_ORDER
# in DeclassifiedArsenal.jsx so the Era filter's sort order stays sensible.
ERA_BOUNDARIES = [
    (1991, "Cold War"),         # year < 1991
    (2001, "Post-Cold War"),    # 1991 <= year < 2001
    (2016, "Modern"),           # 2001 <= year < 2016
    (None, "Next-Gen"),         # 2016 <= year
]

# Heuristics for classify_domain(): lowercase substrings found in a page's
# Wikipedia categories, mapped to a Land / Air / Sea domain. Order matters —
# first match wins, so more specific keywords should sit above generic ones.
DOMAIN_KEYWORDS = [
    ("aircraft carrier", "Sea"),
    ("submarine", "Sea"),
    ("frigate", "Sea"),
    ("destroyer", "Sea"),
    ("corvette", "Sea"),
    ("naval ship", "Sea"),
    ("ships of", "Sea"),
    ("fighter aircraft", "Air"),
    ("bomber aircraft", "Air"),
    ("military aircraft", "Air"),
    ("attack helicopter", "Air"),
    ("military helicopters", "Air"),
    ("tank", "Land"),
    ("armoured fighting vehicle", "Land"),
    ("armored fighting vehicle", "Land"),
    ("infantry fighting vehicle", "Land"),
    ("self-propelled artillery", "Land"),
    ("military vehicles", "Land"),
]

# Infobox row labels (lowercased, substring match) mapped onto the clean
# spec keys the frontend renders. Extend this table as you encounter new
# infobox layouts across different vehicle types.
SPEC_FIELD_MAP = [
    ("crew", "crew"),
    ("length", "length"),
    ("wingspan", "wingspan"),
    ("weight", "combatWeight"),
    ("mass", "combatWeight"),
    ("maximum speed", "maxSpeed"),
    ("speed", "maxSpeed"),
    ("service ceiling", "serviceCeiling"),
    ("range", "range"),
    ("combat radius", "combatRadius"),
    ("engine", "powerplant"),
    ("powerplant", "powerplant"),
    ("armament", "armament"),
    ("armor", "armor"),
    ("armour", "armor"),
    ("primary armament", "armament"),
]

DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"

# Resolved relative to this file, not the current working directory, so
# `python extractor_bot.py` works the same whether run from the repo root
# or from inside scripts/.
DEFAULT_OUTPUT_PATH = Path(__file__).resolve().parent.parent / "public" / "data" / "vehicles.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("extractor_bot")


# ============================================================================
# MediaWiki API helpers
# ============================================================================

def make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def wiki_api_get(session: requests.Session, params: Dict[str, Any]) -> Dict[str, Any]:
    """GET against the MediaWiki Action API with retry + backoff, then sleep
    the baseline politeness delay before returning."""
    params = {**params, "format": "json"}
    last_error: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = session.get(WIKIPEDIA_API, params=params, timeout=20)
            resp.raise_for_status()
            time.sleep(REQUEST_DELAY_SECONDS)
            return resp.json()
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            backoff = REQUEST_DELAY_SECONDS * attempt + random.uniform(0, 0.5)
            log.warning("API request failed (attempt %d/%d): %s — retrying in %.1fs",
                        attempt, MAX_RETRIES, exc, backoff)
            time.sleep(backoff)
    raise RuntimeError(f"MediaWiki API request failed after {MAX_RETRIES} attempts") from last_error


def fetch_page_html(session: requests.Session, title: str) -> Optional[str]:
    data = wiki_api_get(session, {"action": "parse", "page": title, "prop": "text", "redirects": 1})
    if "error" in data:
        log.warning("No page found for %r: %s", title, data["error"].get("info"))
        return None
    return data["parse"]["text"]["*"]


def fetch_categories(session: requests.Session, title: str) -> List[str]:
    data = wiki_api_get(session, {
        "action": "query", "titles": title, "prop": "categories", "cllimit": "max",
    })
    pages = data.get("query", {}).get("pages", {})
    for page in pages.values():
        cats = page.get("categories", [])
        return [c["title"].replace("Category:", "") for c in cats]
    return []


def fetch_plain_summary(session: requests.Session, title: str) -> str:
    data = wiki_api_get(session, {
        "action": "query", "titles": title, "prop": "extracts",
        "exintro": 1, "explaintext": 1, "redirects": 1,
    })
    pages = data.get("query", {}).get("pages", {})
    for page in pages.values():
        return (page.get("extract") or "").strip()
    return ""


def fetch_category_members(session: requests.Session, category: str, limit: int) -> List[str]:
    """Paginate through Category:<category> collecting article titles until
    `limit` is reached (or the category is exhausted)."""
    titles: List[str] = []
    cmcontinue: Optional[str] = None
    while len(titles) < limit:
        params = {
            "action": "query", "list": "categorymembers",
            "cmtitle": f"Category:{category}", "cmlimit": min(500, limit - len(titles)),
            "cmtype": "page",
        }
        if cmcontinue:
            params["cmcontinue"] = cmcontinue
        data = wiki_api_get(session, params)
        members = data.get("query", {}).get("categorymembers", [])
        titles.extend(m["title"] for m in members)
        cmcontinue = data.get("continue", {}).get("cmcontinue")
        if not cmcontinue:
            break
    return titles[:limit]


# ============================================================================
# Parsing & normalization
# ============================================================================

def parse_infobox(html: str) -> Dict[str, str]:
    """Pull label -> value pairs out of the page's `table.infobox`, stripping
    citation markers like '[1]' and collapsing whitespace."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", class_=re.compile(r"\binfobox\b"))
    if table is None:
        return {}

    raw: Dict[str, str] = {}
    for row in table.find_all("tr"):
        header = row.find("th")
        value_cell = row.find("td")
        if header is None or value_cell is None:
            continue
        label = clean_text(header.get_text(" "))
        value = clean_text(value_cell.get_text(" "))
        if label and value:
            raw[label] = value
    return raw


def clean_text(text: str) -> str:
    text = re.sub(r"\[\d+\]", "", text)       # footnote markers, e.g. [1]
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_specs(raw_specs: Dict[str, str]) -> Dict[str, str]:
    """Rename the whitelisted subset of infobox rows onto the clean keys the
    frontend expects. Unmapped rows are dropped rather than passed through,
    to keep the spec grid readable across wildly different infobox layouts."""
    specs: Dict[str, str] = {}
    for raw_label, raw_value in raw_specs.items():
        label_lower = raw_label.lower()
        for needle, clean_key in SPEC_FIELD_MAP:
            if needle in label_lower and clean_key not in specs:
                specs[clean_key] = raw_value
                break
    return specs


def classify_domain(categories: List[str]) -> str:
    joined = " | ".join(categories).lower()
    for needle, domain in DOMAIN_KEYWORDS:
        if needle in joined:
            return domain
    log.warning("Could not classify domain from categories; defaulting to 'Land'")
    return "Land"


def extract_year(raw_specs: Dict[str, str]) -> Optional[int]:
    for label, value in raw_specs.items():
        if "service" in label.lower() or "introduc" in label.lower() or "produced" in label.lower():
            match = re.search(r"(18|19|20)\d{2}", value)
            if match:
                return int(match.group(0))
    return None


def bucket_era(year: Optional[int]) -> str:
    if year is None:
        return "Unknown"
    for boundary, era in ERA_BOUNDARIES:
        if boundary is None or year < boundary:
            return era
    return ERA_BOUNDARIES[-1][1]


# Common nation names -> a short readable code for the id slug. Not
# exhaustive — extend as your dataset's nation list grows; anything missing
# falls back to the first two letters of the (normalized) name below.
NATION_CODE_OVERRIDES = {
    "united states": "us", "united kingdom": "uk", "china": "cn", "russia": "ru",
    "soviet union": "su", "israel": "il", "germany": "de", "france": "fr",
    "italy": "it", "spain": "es", "japan": "jp", "india": "in",
    "south korea": "kr", "north korea": "kp", "ukraine": "ua", "sweden": "se",
    "poland": "pl", "turkey": "tr", "brazil": "br", "canada": "ca",
    "australia": "au", "netherlands": "nl", "switzerland": "ch",
}


def slugify(nation: str, name: str) -> str:
    nation_key = nation.lower().strip()
    country_code = NATION_CODE_OVERRIDES.get(
        nation_key, re.sub(r"[^a-z0-9]+", "", nation_key)[:2] or "xx"
    )
    name_slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return f"{country_code}-{name_slug}"


def guess_nation(categories: List[str], title: str) -> str:
    """Best-effort nation guess from category text (e.g. 'Tanks of the
    United States'). Falls back to 'Unknown' — worth a manual pass on the
    output before shipping a batch, since this heuristic is intentionally
    simple."""
    for cat in categories:
        match = re.search(r"of (?:the )?([A-Z][A-Za-z .]+)$", cat)
        if match:
            return match.group(1).strip()
    return "Unknown"


# ============================================================================
# LLM integration — turns raw specs into "The Layman's Brief"
# ============================================================================

BRIEF_PROMPT_TEMPLATE = """You are writing "The Layman's Brief" for a military technology \
encyclopedia. In 2-4 sentences, translate the vehicle below into its plain-language tactical \
philosophy: what problem it was built to solve and what trade-off defines it. Write for a curious \
general reader, not a specialist. Do not invent specs that are not implied by the data. Avoid \
marketing language.

Vehicle: {name} ({designation})
Nation: {nation}
Role: {role}
Wikipedia summary: {summary}
Key specs: {specs}

Respond with only the brief itself, no preamble or heading."""


def _call_anthropic(session: requests.Session, prompt: str, model: str) -> str:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")
    resp = session.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": 300,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return "".join(block.get("text", "") for block in data.get("content", []) if block.get("type") == "text").strip()


def _call_openai(session: requests.Session, prompt: str, model: str) -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    resp = session.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "content-type": "application/json"},
        json={
            "model": model,
            "max_tokens": 300,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"].strip()


def generate_laymans_brief(
    session: requests.Session,
    vehicle: Dict[str, Any],
    summary: str,
    use_llm: bool,
    provider: str,
    model: str,
) -> str:
    """Generate the plain-language brief. Falls back to a templated sentence
    built from the structured fields whenever the LLM is disabled, unset, or
    the call fails — a single bad or missing API key should never take down
    a 2,500-record batch job."""
    if use_llm:
        prompt = BRIEF_PROMPT_TEMPLATE.format(
            name=vehicle["name"],
            designation=vehicle["designation"],
            nation=vehicle["nation"],
            role=vehicle["role"],
            summary=summary[:800] or "(no summary available)",
            specs=json.dumps(vehicle["specs"]),
        )
        try:
            caller = _call_anthropic if provider == "anthropic" else _call_openai
            brief = caller(session, prompt, model)
            if brief:
                return brief
        except Exception as exc:  # noqa: BLE001 — deliberately broad, see docstring
            log.warning("LLM brief generation failed for %r (%s); using fallback template", vehicle["name"], exc)

    return (
        f"{vehicle['name']} is a {vehicle['role'].lower()} operated by {vehicle['nation']}, "
        f"introduced in {vehicle.get('yearIntroduced') or 'an undetermined year'}. "
        f"A full tactical brief has not yet been generated for this record."
    )


# ============================================================================
# Per-record pipeline
# ============================================================================

def process_title(
    session: requests.Session,
    title: str,
    use_llm: bool,
    provider: str,
    model: str,
) -> Optional[Dict[str, Any]]:
    """Fetch, parse, normalize and enrich a single Wikipedia page into a
    Vehicle record. Returns None (and logs) on any failure so one bad title
    never aborts the whole batch."""
    try:
        html = fetch_page_html(session, title)
        if html is None:
            return None

        raw_specs = parse_infobox(html)
        categories = fetch_categories(session, title)
        summary = fetch_plain_summary(session, title)

        nation = guess_nation(categories, title)
        domain = classify_domain(categories)
        year = extract_year(raw_specs)
        era = bucket_era(year)
        specs = normalize_specs(raw_specs)

        vehicle: Dict[str, Any] = {
            "id": slugify(nation, title),
            "name": title,
            "designation": raw_specs.get("Type", raw_specs.get("Role", "")),
            "nation": nation,
            "domain": domain,
            "era": era,
            "yearIntroduced": year,
            "manufacturer": raw_specs.get("Manufacturer", raw_specs.get("Designer", "Unknown")),
            "role": raw_specs.get("Type", raw_specs.get("Role", "Unknown")),
            "thumbnail": "",
            "tags": [t.lower() for t in [nation, domain, era] if t and t != "Unknown"],
            "specs": specs,
        }
        vehicle["laymansBrief"] = generate_laymans_brief(session, vehicle, summary, use_llm, provider, model)
        return vehicle

    except Exception as exc:  # noqa: BLE001 — a single record must never crash the batch
        log.error("Failed to process %r: %s", title, exc)
        return None


# ============================================================================
# I/O helpers
# ============================================================================

def load_title_list(args: argparse.Namespace, session: requests.Session) -> List[str]:
    if args.input:
        with open(args.input, "r", encoding="utf-8") as fh:
            return [line.strip() for line in fh if line.strip()]
    if args.category:
        log.info("Crawling category %r (limit %d)...", args.category, args.limit)
        return fetch_category_members(session, args.category, args.limit)
    raise SystemExit("Provide either --input <file of titles> or --category <Wikipedia category>")


def load_existing(output_path: Path) -> Dict[str, Dict[str, Any]]:
    if not output_path.exists():
        return {}
    try:
        with open(output_path, "r", encoding="utf-8") as fh:
            records = json.load(fh)
        return {r["id"]: r for r in records}
    except (json.JSONDecodeError, KeyError):
        log.warning("Existing output at %s is unreadable; starting fresh", output_path)
        return {}


def write_output_atomic(output_path: Path, records: List[Dict[str, Any]]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(records, fh, indent=2, ensure_ascii=False)
    os.replace(tmp_path, output_path)  # atomic on POSIX — a crash mid-run never corrupts the file


# ============================================================================
# Entry point
# ============================================================================

def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Populate vehicles.json for DECLASSIFIED: ARSENAL")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input", help="Text file of Wikipedia page titles, one per line")
    source.add_argument("--category", help="Wikipedia category name to crawl, e.g. 'Main battle tanks'")
    parser.add_argument("--limit", type=int, default=500, help="Max titles to pull from --category")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_PATH), help="Output JSON path")
    parser.add_argument("--delay", type=float, default=REQUEST_DELAY_SECONDS, help="Seconds between API calls")
    parser.add_argument("--resume", action="store_true", help="Skip ids already present in --output")
    parser.add_argument("--no-llm", dest="use_llm", action="store_false",
                         help="Skip LLM calls; use the templated fallback brief instead")
    parser.add_argument("--provider", choices=["anthropic", "openai"], default="anthropic")
    parser.add_argument("--model", default=None, help="Override the default model for --provider")
    parser.set_defaults(use_llm=True)
    return parser


def main() -> None:
    global REQUEST_DELAY_SECONDS
    args = build_arg_parser().parse_args()
    REQUEST_DELAY_SECONDS = args.delay
    model = args.model or (DEFAULT_ANTHROPIC_MODEL if args.provider == "anthropic" else DEFAULT_OPENAI_MODEL)

    if args.use_llm:
        key_var = "ANTHROPIC_API_KEY" if args.provider == "anthropic" else "OPENAI_API_KEY"
        if not os.environ.get(key_var):
            log.warning("%s is not set — LLM calls will fail per-record and fall back to templated briefs. "
                        "Set the key, or pass --no-llm to skip LLM calls entirely.", key_var)

    session = make_session()
    output_path = Path(args.output)

    existing = load_existing(output_path) if args.resume else {}
    titles = load_title_list(args, session)
    log.info("Loaded %d title(s) to process (%d already present and will be skipped)",
              len(titles), len(existing))

    results: Dict[str, Dict[str, Any]] = dict(existing)
    succeeded = failed = skipped = 0

    for i, title in enumerate(titles, start=1):
        provisional_id = slugify("xx", title)
        if args.resume and any(r["name"] == title for r in existing.values()):
            skipped += 1
            continue

        log.info("[%d/%d] %s", i, len(titles), title)
        record = process_title(session, title, args.use_llm, args.provider, model)
        if record is None:
            failed += 1
            continue

        results[record["id"]] = record
        succeeded += 1

        # Flush periodically so a crash near the end of a long run doesn't
        # lose everything processed so far.
        if succeeded % 25 == 0:
            write_output_atomic(output_path, list(results.values()))

    write_output_atomic(output_path, list(results.values()))
    log.info("Done. %d succeeded, %d failed, %d skipped. Wrote %d total record(s) to %s",
              succeeded, failed, skipped, len(results), output_path)


if __name__ == "__main__":
    main()
