/* machine-data.js
   Maschinenprofile: Marke/Modell -> Aufbau -> Grenzen -> Startwerte pro Kultur-Familie
   Du kannst beliebig weitere Modelle hinzufügen.
*/

window.MACHINE_DB = {
  "New Holland": [
    profile({
      id: "nh_cr11",
      brand: "New Holland",
      model: "CR11",
      architecture: { type: "rotor_twin", threshSystem: "Twin Rotor", cleaning: "High capacity shoe" },
      limits: {
        rotor: { min: 650, max: 1100, step: 10, unit:"U/min", dp:0 },
        concaveFront: { min: 4, max: 35, step: 0.5, unit:"mm", dp:1 },
        concaveRear: { min: 2, max: 30, step: 0.5, unit:"mm", dp:1 },
        fan: { min: 650, max: 1250, step: 10, unit:"U/min", dp:0 },
        upperSieve: { min: 6, max: 25, step: 0.5, unit:"mm", dp:1 },
        lowerSieve: { min: 3, max: 20, step: 0.5, unit:"mm", dp:1 },
        speed: { min: 2, max: 10, step: 0.1, unit:"km/h", dp:1 }
      },
      // Baselines pro Kultur (familiengerecht, rotor-twin)
      baselines: baselinesRotorTwin()
    }),
    profile({
      id: "nh_cr",
      brand: "New Holland",
      model: "CR (Serie – Twin Rotor)",
      architecture: { type: "rotor_twin", threshSystem: "Twin Rotor", cleaning: "Cleaning shoe" },
      limits: defaultLimits(),
      baselines: baselinesRotorTwin()
    })
  ],

  "Case IH": [
    profile({
      id: "case_axial",
      brand: "Case IH",
      model: "Axial-Flow (Serie – Single Rotor)",
      architecture: { type: "rotor_single", threshSystem: "Axial-Flow Rotor", cleaning: "Cleaning shoe" },
      limits: defaultLimits({
        rotor: { min: 350, max: 1050, step: 10, unit:"U/min", dp:0 }
      }),
      baselines: baselinesRotorSingle()
    })
  ],

  "Claas": [
    profile({
      id: "claas_lexion_aps_hybrid",
      brand: "Claas",
      model: "LEXION (APS Hybrid)",
      architecture: { type: "hybrid", threshSystem: "APS + Rotor", cleaning: "JET STREAM / shoe" },
      limits: defaultLimits({
        // Hybrid ist oft empfindlicher: nicht zu aggressiv an Rotor (hier als „rotor“ abgebildet)
        rotor: { min: 450, max: 1000, step: 10, unit:"U/min", dp:0 }
      }),
      baselines: baselinesHybridAPS()
    }),
    profile({
      id: "claas_lexion_walker",
      brand: "Claas",
      model: "LEXION (Schüttler)",
      architecture: { type: "walker", threshSystem: "Dreschtrommel + Schüttler", cleaning: "Siebkasten" },
      limits: defaultLimits({
        rotor: { min: 350, max: 900, step: 10, unit:"U/min", dp:0 } // „rotor“ wird als Dreschtrommel-Drehzahl interpretiert
      }),
      baselines: baselinesWalker()
    })
  ],

  "John Deere": [
    profile({
      id: "jd_s_series",
      brand: "John Deere",
      model: "S-Serie (Schüttler)",
      architecture: { type: "walker", threshSystem: "Dreschtrommel + Schüttler", cleaning: "Siebkasten" },
      limits: defaultLimits({
        rotor: { min: 350, max: 900, step: 10, unit:"U/min", dp:0 }
      }),
      baselines: baselinesWalker()
    }),
    profile({
      id: "jd_x9",
      brand: "John Deere",
      model: "X9 (Rotor)",
      architecture: { type: "rotor_single", threshSystem: "Rotor", cleaning: "High capacity shoe" },
      limits: defaultLimits({
        rotor: { min: 450, max: 1050, step: 10, unit:"U/min", dp:0 }
      }),
      baselines: baselinesRotorSingle()
    })
  ]
};

// --- helpers ---
function profile(p){
  return {
    ...p,
    summary: `${p.brand} ${p.model} • ${p.architecture.threshSystem} • ${p.architecture.cleaning}`
  };
}

function defaultLimits(overrides = {}){
  const base = {
    rotor: { min: 350, max: 1050, step: 10, unit:"U/min", dp:0 },
    concaveFront: { min: 4, max: 35, step: 0.5, unit:"mm", dp:1 },
    concaveRear: { min: 2, max: 30, step: 0.5, unit:"mm", dp:1 },
    fan: { min: 650, max: 1250, step: 10, unit:"U/min", dp:0 },
    upperSieve: { min: 6, max: 25, step: 0.5, unit:"mm", dp:1 },
    lowerSieve: { min: 3, max: 20, step: 0.5, unit:"mm", dp:1 },
    speed: { min: 2, max: 10, step: 0.1, unit:"km/h", dp:1 }
  };
  return { ...base, ...overrides };
}

/* Baselines: bewusst nach Maschinen-Architektur unterschiedlich:
   - twin rotor: eher hohe Separation bei moderater Aggressivität
   - single rotor: etwas aggressiver auf Ausdrusch
   - hybrid APS: sehr wirksam in Vorabscheidung -> Vorschläge kleiner/feiner
   - walker: speed/cleaning sensibler, Separation eher über Trommel/Korb + Schuh entlasten
*/
function baselinesRotorTwin(){
  return {
    weizen: { rotor: 900, concaveFront: 12, concaveRear: 6, fan: 950, upperSieve: 14, lowerSieve: 8, speed: 6.0 },
    gerste: { rotor: 850, concaveFront: 14, concaveRear: 8, fan: 900, upperSieve: 16, lowerSieve: 9, speed: 5.6 },
    raps:   { rotor: 760, concaveFront: 10, concaveRear: 4.5, fan: 860, upperSieve: 10, lowerSieve: 5, speed: 5.0 },
    mais:   { rotor: 450, concaveFront: 26, concaveRear: 18, fan: 800, upperSieve: 18, lowerSieve: 14, speed: 7.0 },
    soja:   { rotor: 600, concaveFront: 20, concaveRear: 12, fan: 760, upperSieve: 14, lowerSieve: 10, speed: 6.0 }
  };
}

function baselinesRotorSingle(){
  return {
    weizen: { rotor: 930, concaveFront: 11.5, concaveRear: 6, fan: 960, upperSieve: 14, lowerSieve: 8, speed: 6.2 },
    gerste: { rotor: 880, concaveFront: 13.5, concaveRear: 8, fan: 910, upperSieve: 16, lowerSieve: 9, speed: 5.7 },
    raps:   { rotor: 780, concaveFront: 9.5, concaveRear: 4.5, fan: 860, upperSieve: 10, lowerSieve: 5, speed: 5.1 },
    mais:   { rotor: 430, concaveFront: 27, concaveRear: 18, fan: 790, upperSieve: 18, lowerSieve: 14, speed: 7.2 },
    soja:   { rotor: 620, concaveFront: 20, concaveRear: 12, fan: 760, upperSieve: 14, lowerSieve: 10, speed: 6.2 }
  };
}

function baselinesHybridAPS(){
  return {
    weizen: { rotor: 860, concaveFront: 12.5, concaveRear: 6.5, fan: 980, upperSieve: 13.5, lowerSieve: 8, speed: 6.4 },
    gerste: { rotor: 820, concaveFront: 14.0, concaveRear: 8.5, fan: 940, upperSieve: 15.5, lowerSieve: 9, speed: 5.9 },
    raps:   { rotor: 740, concaveFront: 10.0, concaveRear: 5.0, fan: 880, upperSieve: 9.5, lowerSieve: 5, speed: 5.2 },
    mais:   { rotor: 420, concaveFront: 28.0, concaveRear: 19.0, fan: 800, upperSieve: 18, lowerSieve: 14, speed: 7.0 },
    soja:   { rotor: 600, concaveFront: 20.0, concaveRear: 12.5, fan: 760, upperSieve: 14, lowerSieve: 10, speed: 6.2 }
  };
}

function baselinesWalker(){
  return {
    weizen: { rotor: 780, concaveFront: 12.5, concaveRear: 7.0, fan: 980, upperSieve: 13.0, lowerSieve: 8.0, speed: 5.6 },
    gerste: { rotor: 760, concaveFront: 14.5, concaveRear: 9.0, fan: 940, upperSieve: 15.0, lowerSieve: 9.0, speed: 5.2 },
    raps:   { rotor: 700, concaveFront: 10.5, concaveRear: 5.0, fan: 900, upperSieve: 9.5, lowerSieve: 5.0, speed: 4.8 },
    mais:   { rotor: 420, concaveFront: 28.0, concaveRear: 20.0, fan: 820, upperSieve: 18.0, lowerSieve: 14.0, speed: 6.5 },
    soja:   { rotor: 560, concaveFront: 21.0, concaveRear: 13.0, fan: 780, upperSieve: 14.0, lowerSieve: 10.0, speed: 5.8 }
  };
}
