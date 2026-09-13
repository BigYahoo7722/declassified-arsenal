import React, { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  X,
  Truck,
  Plane,
  Anchor,
  Radar,
  ScanLine,
  Shield,
  Info,
  ChevronDown,
} from "lucide-react";

/* ============================================================================
   DECLASSIFIED: ARSENAL — Command Dashboard
   ----------------------------------------------------------------------------
   VEHICLE SCHEMA (this exact shape is the contract with the Python extractor
   in Part 2 — every field below must be present in each object of the JSON
   array that extractor_bot.py writes to /public/data/vehicles.json):

     {
       id:             string   e.g. "cn-j8a-finback"
       name:           string   e.g. "Shenyang J-8A"
       designation:    string   e.g. "NATO reporting name: Finback-A"
       nation:         string   e.g. "China"
       domain:         "Land" | "Air" | "Sea"
       era:            string   e.g. "Cold War" | "Post-Cold War" | "Modern" | "Next-Gen"
       yearIntroduced: number   e.g. 1980
       manufacturer:   string
       role:           string   e.g. "High-Altitude Interceptor"
       thumbnail:      string   path to an image, or "" to use the hangar placeholder
       laymansBrief:   string   plain-language tactical philosophy, 2-4 sentences
       tags:           string[] free-text keywords used by the search index
       specs:          Record<string, string>  arbitrary label/value spec pairs
     }

   At 2,500+ records, this component is written to run against a fetched
   JSON payload rather than hard-coded data — see the useEffect below.
   ============================================================================ */

const DOMAIN_META = {
  Land: { icon: Truck },
  Air: { icon: Plane },
  Sea: { icon: Anchor },
};

// Vite exposes the configured build --base as import.meta.env.BASE_URL. It's
// "/" for local dev and for a root-domain deploy (e.g. Vercel), but on
// GitHub Pages a project site is served under a subpath like
// "/declassified-arsenal/" — so every hardcoded public/ asset path is built
// from this constant instead of a bare "/logo.png" style string.
const ASSET_BASE = import.meta.env.BASE_URL;
function asset(path) {
  return `${ASSET_BASE}${path}`.replace(/([^:]\/)\/+/g, "$1");
}

// Canonical chronological order for the Era filter — falls back to
// alphabetical for any era string the dataset introduces that isn't listed
// here, so unrecognized eras from a future data drop never get dropped.
const ERA_ORDER = ["Cold War", "Post-Cold War", "Modern", "Next-Gen"];

/* ---------------------------- Mock dataset ---------------------------------
   Exactly 4 records, standing in for the 2,500+ the pipeline will produce.
   Specs are trimmed to the fields that matter for a fast read, not an
   exhaustive manual — the full pipeline can carry a much larger spec set. */
const MOCK_VEHICLES = [
  {
    id: "cn-j8a-finback",
    name: "Shenyang J-8A",
    designation: "NATO reporting name: Finback-A",
    nation: "China",
    domain: "Air",
    era: "Cold War",
    yearIntroduced: 1980,
    manufacturer: "Shenyang Aircraft Corporation",
    role: "High-Altitude Interceptor",
    thumbnail: "",
    laymansBrief:
      "The J-8A was built around a single idea: get high and get there fast, before the other side even knows you're coming. It traded dogfighting agility for a long, needle-nosed airframe that could sprint past twice the speed of sound and claw up past 20,000 meters — enough to reach and down high-flying bombers and reconnaissance aircraft that older Chinese fighters simply couldn't touch. It's less a knife-fighter and more a gatekeeper for the upper sky.",
    tags: ["china", "interceptor", "jet", "fighter", "cold war", "finback", "pla air force"],
    specs: {
      crew: "1",
      length: "21.59 m",
      wingspan: "9.34 m",
      maxSpeed: "Mach 2.2",
      serviceCeiling: "20,200 m",
      range: "1,988 km",
      powerplant: "2x Wopen WP-7B turbojets",
      armament: "1x 23mm cannon, PL-2 / PL-5 air-to-air missiles",
    },
  },
  {
    id: "us-m1a2-abrams",
    name: "M1A2 Abrams",
    designation: "Main Battle Tank",
    nation: "United States",
    domain: "Land",
    era: "Post-Cold War",
    yearIntroduced: 1992,
    manufacturer: "General Dynamics Land Systems",
    role: "Main Battle Tank",
    thumbnail: "",
    laymansBrief:
      "The M1A2 is built on a simple trade: burn fuel fast in exchange for surviving almost anything. Its gas-turbine engine gives it a sprint speed that lets it outmaneuver older tanks, while layered composite armor around the crew compartment is designed so that if it does get hit, the crew walks away. The 120mm cannon and networked targeting sensors mean it's built to see and kill first, rather than trade blows.",
    tags: ["usa", "tank", "mbt", "armor", "abrams", "army", "post cold war"],
    specs: {
      crew: "4",
      length: "9.83 m (gun forward)",
      combatWeight: "~68 tons",
      maxSpeed: "67 km/h (road, governed)",
      range: "426 km",
      powerplant: "Honeywell AGT1500 gas turbine, 1,500 hp",
      armament: "120mm M256 smoothbore, .50 cal + 7.62mm secondaries",
      armor: "Second-generation Chobham composite",
    },
  },
  {
    id: "il-merkava-mk4",
    name: "Merkava Mk4",
    designation: "Main Battle Tank",
    nation: "Israel",
    domain: "Land",
    era: "Modern",
    yearIntroduced: 2004,
    manufacturer: "Israel Ordnance Corps / IMI",
    role: "Main Battle Tank",
    thumbnail: "",
    laymansBrief:
      "Most tanks put the engine at the back to protect the crew from a rear-facing threat; the Merkava puts it at the front, on purpose. That single design choice turns the rear of the hull into an armored compartment that can evacuate wounded crew or carry infantry, reflecting a doctrine built around crew survivability above almost everything else. Add an active protection system that shoots down incoming anti-tank missiles before impact, and the philosophy becomes clear: bring everyone home.",
    tags: ["israel", "tank", "mbt", "merkava", "armor", "idf", "modern"],
    specs: {
      crew: "4 (+ up to 6 dismounts)",
      length: "9.04 m (gun forward)",
      combatWeight: "~65 tons",
      maxSpeed: "64 km/h",
      range: "500 km",
      powerplant: "GD883 turbocharged diesel, 1,500 hp",
      armament: "120mm MG253 smoothbore, 60mm internal mortar",
      armor: "Modular composite + Trophy active protection system",
    },
  },
  {
    id: "eu-eurofighter-typhoon",
    name: "Eurofighter Typhoon",
    designation: "Multirole Fighter",
    nation: "Multinational (UK / Germany / Italy / Spain)",
    domain: "Air",
    era: "Modern",
    yearIntroduced: 2003,
    manufacturer: "Eurofighter GmbH (BAE / Airbus / Leonardo)",
    role: "Air Superiority & Multirole Fighter",
    thumbnail: "",
    laymansBrief:
      "The Typhoon was designed as a compromise made deliberately, not by accident: a relaxed-stability delta-canard airframe that's naturally unstable and needs constant computer correction to fly, which is exactly what makes it so agile in a dogfight. It was built by four nations that each wanted a different aircraft, and the result is a jack-of-all-trades that can intercept, escort, and drop precision munitions in the same sortie rather than being locked into a single job.",
    tags: ["eurofighter", "typhoon", "multinational", "fighter", "jet", "raf", "modern", "nato"],
    specs: {
      crew: "1 (2 for trainer variant)",
      length: "15.96 m",
      wingspan: "10.95 m",
      maxSpeed: "Mach 2.0",
      serviceCeiling: "19,812 m",
      combatRadius: "1,389 km",
      powerplant: "2x Eurojet EJ200 turbofans w/ afterburner",
      armament: "1x 27mm Mauser cannon, 13 hardpoints (AMRAAM / ASRAAM / Meteor)",
    },
  },
];

/* ---------------------------- Search helpers -------------------------------
   Fast substring check first (the common case), falling back to an in-order
   subsequence match so a query like "m1a2" still finds "M1A2 Abrams" even
   with a typo-tolerant, non-contiguous match. Both passes are O(n) per
   record, which stays comfortably cheap even at 2,500 records per keystroke. */
function fuzzyMatch(query, haystack) {
  if (!query) return true;
  if (haystack.includes(query)) return true;
  let qi = 0;
  for (let i = 0; i < haystack.length && qi < query.length; i++) {
    if (haystack[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

function withSearchBlob(vehicle) {
  return {
    ...vehicle,
    _blob: [
      vehicle.name,
      vehicle.designation,
      vehicle.nation,
      vehicle.role,
      vehicle.manufacturer,
      ...(vehicle.tags || []),
    ]
      .join(" ")
      .toLowerCase(),
  };
}

function formatLabel(key) {
  const spaced = key.replace(/([A-Z])/g, " $1").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Two hangar placeholder photos are provided; alternate between them per
// vehicle id (deterministically, so a given card always shows the same one
// between renders and between the grid card and its Dossier modal).
function hangarPlaceholderFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 2 === 0 ? asset("hangar-placeholder.png") : asset("hangar-placeholder-alt.png");
}

function sortEras(eras) {
  return [...eras].sort((a, b) => {
    const ia = ERA_ORDER.indexOf(a);
    const ib = ERA_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/* ---------------------------- Small sub-components -------------------------- */

function FilterPill({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
        active
          ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
          : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/20 hover:text-zinc-200"
      }`}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

function SelectField({ label, value, options, onChange }) {
  return (
    <label className="relative flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 py-2 pl-3 pr-8 text-sm">
      <span className="font-mono text-xs uppercase text-zinc-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer appearance-none bg-transparent pr-2 text-zinc-200 outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-zinc-900">
            {o}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
    </label>
  );
}

function VehicleCard({ vehicle, onOpen }) {
  const Icon = DOMAIN_META[vehicle.domain]?.icon ?? Shield;
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      whileHover={{ y: -4 }}
      onClick={onOpen}
      className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 text-left transition-colors hover:border-cyan-400/30"
    >
      {/* low-opacity seal watermark */}
      <img
        src={asset("logo.png")}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute -right-4 -top-4 h-20 w-20 opacity-5 transition-opacity group-hover:opacity-10"
      />

      <div className="relative h-44 overflow-hidden">
        <img
          src={vehicle.thumbnail || hangarPlaceholderFor(vehicle.id)}
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = hangarPlaceholderFor(vehicle.id);
          }}
          alt={vehicle.name}
          className="h-full w-full object-cover opacity-80 transition-all duration-500 group-hover:scale-105 group-hover:opacity-100"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/10 to-transparent" />
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md border border-white/10 bg-zinc-950/70 px-2 py-1 text-xs font-mono text-cyan-300">
          <Icon className="h-3 w-3" />
          {vehicle.domain.toUpperCase()}
        </span>
        <span className="absolute right-2 top-2 rounded-md border border-white/10 bg-zinc-950/70 px-2 py-1 text-xs font-mono text-amber-300">
          {vehicle.era}
        </span>
      </div>

      <div className="p-3.5">
        <p className="font-mono text-xs text-zinc-500">{vehicle.nation}</p>
        <h3 className="text-sm font-semibold leading-snug text-zinc-100">{vehicle.name}</h3>
        <p className="mt-0.5 text-xs text-zinc-500">{vehicle.designation}</p>
      </div>
    </motion.button>
  );
}

function SpecRow({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-2 text-sm last:border-none sm:border-none">
      <span className="text-zinc-500">{formatLabel(label)}</span>
      <span className="text-right font-mono text-zinc-200">{value}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Radar className="mb-3 h-10 w-10 text-zinc-700" />
      <p className="text-sm text-zinc-400">No records match this query.</p>
      <p className="mt-1 text-xs text-zinc-600">Adjust the filters or clear the search field.</p>
    </div>
  );
}

function DossierModal({ vehicle, onClose }) {
  const [blueprint, setBlueprint] = useState(false);
  const Icon = DOMAIN_META[vehicle.domain]?.icon ?? Shield;

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="absolute inset-0 bg-zinc-950/85 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={vehicle.name}
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="relative max-h-full w-full max-w-4xl overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dossier"
          className="absolute right-3 top-3 z-20 rounded-full border border-white/10 bg-zinc-950/70 p-1.5 text-zinc-400 transition-colors hover:border-white/30 hover:text-zinc-100"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Image / Blueprint Mode area */}
        <div className="relative aspect-video overflow-hidden border-b border-white/10">
          <AnimatePresence initial={false} mode="wait">
            {!blueprint ? (
              <motion.img
                key="photo"
                src={vehicle.thumbnail || hangarPlaceholderFor(vehicle.id)}
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = hangarPlaceholderFor(vehicle.id);
                }}
                alt={vehicle.name}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <motion.div
                key="blueprint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="absolute inset-0"
              >
                <img
                  src={asset("blueprint-bg.png")}
                  alt="Technical schematic overlay"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-cyan-500/10 mix-blend-overlay" />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent" />

          {/* Radar sweep, only while Blueprint Mode is active */}
          {blueprint && (
            <motion.div
              className="absolute left-0 right-0 h-px bg-cyan-400/70 shadow-lg shadow-cyan-500/50"
              initial={{ top: "0%" }}
              animate={{ top: ["0%", "100%"] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
            />
          )}

          <button
            type="button"
            onClick={() => setBlueprint((b) => !b)}
            className={`absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-mono transition-colors ${
              blueprint
                ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
                : "border-white/10 bg-zinc-950/70 text-zinc-300 hover:border-white/30"
            }`}
          >
            <ScanLine className="h-3.5 w-3.5" />
            {blueprint ? "Exit Blueprint Mode" : "Blueprint Mode"}
          </button>

          <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-md border border-white/10 bg-zinc-950/70 px-2 py-1 text-xs font-mono text-zinc-300">
            <Icon className="h-3 w-3" />
            {vehicle.domain.toUpperCase()}
          </span>
        </div>

        <div className="space-y-6 p-5 sm:p-7">
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-zinc-500">{vehicle.nation}</p>
            <h2 className="mt-1 text-2xl font-semibold text-zinc-50">{vehicle.name}</h2>
            <p className="text-sm text-zinc-500">{vehicle.designation}</p>
            <p className="mt-2 text-sm text-zinc-400">
              {vehicle.role} — manufactured by {vehicle.manufacturer}, introduced {vehicle.yearIntroduced}
            </p>
          </div>

          <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Info className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-amber-300">The Layman's Brief</h3>
            </div>
            <p className="text-sm leading-relaxed text-zinc-300">{vehicle.laymansBrief}</p>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-cyan-300">Specifications</h3>
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              {Object.entries(vehicle.specs).map(([key, value]) => (
                <SpecRow key={key} label={key} value={value} />
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Header({ resultCount, total }) {
  return (
    <header className="border-b border-white/10 bg-zinc-950/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <img src={asset("logo.png")} alt="Eclipse Division seal" className="h-10 w-10 object-contain" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-50 sm:text-xl">
              DECLASSIFIED<span className="text-amber-400">:</span> ARSENAL
            </h1>
            <p className="font-mono text-xs text-zinc-500">Global Arsenal Intelligence Database</p>
          </div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/5 px-3 py-1.5 sm:flex">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
          </span>
          <span className="font-mono text-xs text-cyan-300">
            {resultCount} / {total} records
          </span>
        </div>
      </div>
    </header>
  );
}

function CommandFilterBar({ queryInput, setQueryInput, domain, setDomain, nation, setNation, era, setEra, nations, eras }) {
  const domains = ["All", "Land", "Air", "Sea"];
  return (
    <div className="border-b border-white/10 bg-zinc-950/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center">
        <div className="relative w-full flex-1 lg:w-auto">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Search designation, nation, role..."
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-amber-400/50"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {domains.map((d) => (
            <FilterPill
              key={d}
              active={domain === d}
              onClick={() => setDomain(d)}
              icon={d === "All" ? Radar : DOMAIN_META[d]?.icon}
              label={d}
            />
          ))}
        </div>

        <SelectField label="Nation" value={nation} options={nations} onChange={setNation} />
        <SelectField label="Era" value={era} options={eras} onChange={setEra} />
      </div>
    </div>
  );
}

/* ---------------------------- Main component --------------------------------
   The number of results rendered per "page" is capped and grown with a
   Load More action. At 2,500+ records this keeps the DOM node count (and
   therefore the Framer Motion layout animation cost) bounded regardless of
   how broad the current filter is — swap PAGE_SIZE growth for a windowing
   library (react-window / react-virtuoso) if the dataset grows further and
   Load More clicks become a UX bottleneck. */
const PAGE_SIZE = 24;

export default function DeclassifiedArsenal() {
  const [rawVehicles, setRawVehicles] = useState(MOCK_VEHICLES);

  // Production data flow: extractor_bot.py (Part 2) writes the full 2,500+
  // record set to /public/data/vehicles.json. This fetch picks it up if
  // present, and silently falls back to the 4 mock records otherwise so the
  // UI is always demoable, even before the pipeline has run.
  useEffect(() => {
    let cancelled = false;
    fetch(asset("data/vehicles.json"))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("no dataset"))))
      .then((json) => {
        if (!cancelled && Array.isArray(json) && json.length > 0) setRawVehicles(json);
      })
      .catch(() => {
        /* expected until the extractor has produced a dataset — mock data stands in */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const data = useMemo(() => rawVehicles.map(withSearchBlob), [rawVehicles]);

  // Search text is decoupled from the debounced value actually used for
  // filtering, so the input stays instantly responsive while the (more
  // expensive, layout-animated) grid re-render is debounced.
  const [queryInput, setQueryInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(queryInput.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [queryInput]);

  const [domain, setDomain] = useState("All");
  const [nation, setNation] = useState("All");
  const [era, setEra] = useState("All");
  const [selected, setSelected] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const nations = useMemo(() => ["All", ...Array.from(new Set(data.map((v) => v.nation))).sort()], [data]);
  const eras = useMemo(() => ["All", ...sortEras(Array.from(new Set(data.map((v) => v.era))))], [data]);

  const filtered = useMemo(() => {
    return data.filter((v) => {
      if (nation !== "All" && v.nation !== nation) return false;
      if (domain !== "All" && v.domain !== domain) return false;
      if (era !== "All" && v.era !== era) return false;
      if (debouncedQuery && !fuzzyMatch(debouncedQuery, v._blob)) return false;
      return true;
    });
  }, [data, nation, domain, era, debouncedQuery]);

  // Reset pagination whenever the active filter set changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [nation, domain, era, debouncedQuery]);

  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="min-h-screen bg-zinc-950 font-sans text-zinc-200">
      {/* Global backdrop: the cyan tech/radar grid, heavily darkened */}
      <div className="fixed inset-0 -z-10">
        <img src={asset("blueprint-bg.png")} alt="" aria-hidden="true" className="h-full w-full object-cover opacity-10" />
        <div className="absolute inset-0 bg-zinc-950/90" />
      </div>

      <div className="sticky top-0 z-40">
        <Header resultCount={filtered.length} total={data.length} />
        <CommandFilterBar
          queryInput={queryInput}
          setQueryInput={setQueryInput}
          domain={domain}
          setDomain={setDomain}
          nation={nation}
          setNation={setNation}
          era={era}
          setEra={setEra}
          nations={nations}
          eras={eras}
        />
      </div>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <motion.div layout className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <AnimatePresence>
                {visible.map((v) => (
                  <VehicleCard key={v.id} vehicle={v} onOpen={() => setSelected(v)} />
                ))}
              </AnimatePresence>
            </motion.div>

            {visibleCount < filtered.length && (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm text-zinc-300 transition-colors hover:border-amber-400/40 hover:text-amber-300"
                >
                  Load {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <AnimatePresence>
        {selected && <DossierModal vehicle={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  );
}
