(function(){
  function Arch(type, threshSystem, cleaning){
    return { type, threshSystem, cleaning };
  }
  function P(id, brand, model, architecture, limits, baselines){
    return { id, brand, model, architecture, limits, baselines,
      summary: `${brand} ${model} • ${architecture.threshSystem} • ${architecture.cleaning}` };
  }

  function L_base(o = {}){
    const base = {
      rotor: { min: 350, max: 1050, step: 10, unit:"U/min", dp:0 },
      concaveFront: { min: 4, max: 35, step: 0.5, unit:"mm", dp:1 },
      concaveRear: { min: 2, max: 30, step: 0.5, unit:"mm", dp:1 },
      fan: { min: 650, max: 1250, step: 10, unit:"U/min", dp:0 },
      upperSieve: { min: 6, max: 25, step: 0.5, unit:"mm", dp:1 },
      lowerSieve: { min: 3, max: 20, step: 0.5, unit:"mm", dp:1 },
      speed: { min: 2, max: 10, step: 0.1, unit:"km/h", dp:1 }
    };
    return { ...base, ...o };
  }
  const L_rotorTwin   = (o={})=>L_base({ rotor:{min:450,max:1100,step:10,unit:"U/min",dp:0}, ...o });
  const L_rotorSingle = (o={})=>L_base({ rotor:{min:450,max:1050,step:10,unit:"U/min",dp:0}, ...o });
  const L_hybrid      = (o={})=>L_base({ rotor:{min:450,max:1000,step:10,unit:"U/min",dp:0}, ...o });
  const L_walker      = (o={})=>L_base({ rotor:{min:350,max:900,step:10,unit:"U/min",dp:0}, ...o });

  function B_rotorTwin(){
    return {
      weizen: { rotor: 900, concaveFront: 12, concaveRear: 6, fan: 950, upperSieve: 14, lowerSieve: 8, speed: 6.0 },
      gerste: { rotor: 850, concaveFront: 14, concaveRear: 8, fan: 900, upperSieve: 16, lowerSieve: 9, speed: 5.6 },
      raps:   { rotor: 760, concaveFront: 10, concaveRear: 4.5, fan: 860, upperSieve: 10, lowerSieve: 5, speed: 5.0 },
      mais:   { rotor: 450, concaveFront: 26, concaveRear: 18, fan: 800, upperSieve: 18, lowerSieve: 14, speed: 7.0 },
      soja:   { rotor: 600, concaveFront: 20, concaveRear: 12, fan: 760, upperSieve: 14, lowerSieve: 10, speed: 6.0 }
    };
  }
  function B_rotorSingle(){
    return {
      weizen: { rotor: 930, concaveFront: 11.5, concaveRear: 6, fan: 960, upperSieve: 14, lowerSieve: 8, speed: 6.2 },
      gerste: { rotor: 880, concaveFront: 13.5, concaveRear: 8, fan: 910, upperSieve: 16, lowerSieve: 9, speed: 5.7 },
      raps:   { rotor: 780, concaveFront: 9.5, concaveRear: 4.5, fan: 860, upperSieve: 10, lowerSieve: 5, speed: 5.1 },
      mais:   { rotor: 430, concaveFront: 27, concaveRear: 18, fan: 790, upperSieve: 18, lowerSieve: 14, speed: 7.2 },
      soja:   { rotor: 620, concaveFront: 20, concaveRear: 12, fan: 760, upperSieve: 14, lowerSieve: 10, speed: 6.2 }
    };
  }
  function B_hybrid(){
    return {
      weizen: { rotor: 860, concaveFront: 12.5, concaveRear: 6.5, fan: 980, upperSieve: 13.5, lowerSieve: 8, speed: 6.4 },
      gerste: { rotor: 820, concaveFront: 14.0, concaveRear: 8.5, fan: 940, upperSieve: 15.5, lowerSieve: 9, speed: 5.9 },
      raps:   { rotor: 740, concaveFront: 10.0, concaveRear: 5.0, fan: 880, upperSieve: 9.5, lowerSieve: 5, speed: 5.2 },
      mais:   { rotor: 420, concaveFront: 28.0, concaveRear: 19.0, fan: 800, upperSieve: 18, lowerSieve: 14, speed: 7.0 },
      soja:   { rotor: 600, concaveFront: 20.0, concaveRear: 12.5, fan: 760, upperSieve: 14, lowerSieve: 10, speed: 6.2 }
    };
  }
  function B_walker(){
    return {
      weizen: { rotor: 780, concaveFront: 12.5, concaveRear: 7.0, fan: 980, upperSieve: 13.0, lowerSieve: 8.0, speed: 5.6 },
      gerste: { rotor: 760, concaveFront: 14.5, concaveRear: 9.0, fan: 940, upperSieve: 15.0, lowerSieve: 9.0, speed: 5.2 },
      raps:   { rotor: 700, concaveFront: 10.5, concaveRear: 5.0, fan: 900, upperSieve: 9.5, lowerSieve: 5.0, speed: 4.8 },
      mais:   { rotor: 420, concaveFront: 28.0, concaveRear: 20.0, fan: 820, upperSieve: 18.0, lowerSieve: 14.0, speed: 6.5 },
      soja:   { rotor: 560, concaveFront: 21.0, concaveRear: 13.0, fan: 780, upperSieve: 14.0, lowerSieve: 10.0, speed: 5.8 }
    };
  }

  window.MACHINE_DB = {
    "New Holland": [
      P("nh_cr11","New Holland","CR11", Arch("rotor_twin","Twin Rotor","High capacity shoe"), L_rotorTwin({rotor:{min:650,max:1100,step:10,unit:"U/min",dp:0}}), B_rotorTwin()),
      P("nh_cr","New Holland","CR (Twin Rotor Serie)", Arch("rotor_twin","Twin Rotor","Cleaning shoe"), L_rotorTwin(), B_rotorTwin()),
      P("nh_cx","New Holland","CX (Schüttler)", Arch("walker","Trommel + Schüttler","Siebkasten"), L_walker(), B_walker()),
      P("nh_tc","New Holland","TC (Schüttler)", Arch("walker","Trommel + Schüttler","Siebkasten"), L_walker(), B_walker()),
      P("nh_ch","New Holland","CH (Hybrid)", Arch("hybrid","Hybrid Dreschsystem","Siebkasten"), L_hybrid(), B_hybrid())
    ],
    "Case IH": [
      P("case_axial","Case IH","Axial-Flow (Serie)", Arch("rotor_single","Axial-Flow Single Rotor","Cleaning shoe"), L_rotorSingle({rotor:{min:450,max:980,step:10,unit:"U/min",dp:0}}), B_rotorSingle()),
      P("case_af10","Case IH","AF10", Arch("rotor_single","Axial-Flow Single Rotor","High capacity shoe"), L_rotorSingle({rotor:{min:450,max:1050,step:10,unit:"U/min",dp:0}, fan:{min:700,max:1250,step:10,unit:"U/min",dp:0}}), B_rotorSingle())
    ],
    "Claas": [
      P("claas_lexion","Claas","LEXION (APS Hybrid)", Arch("hybrid","APS + Rotor","Siebkasten"), L_hybrid({rotor:{min:500,max:1000,step:10,unit:"U/min",dp:0}, fan:{min:750,max:1250,step:10,unit:"U/min",dp:0}}), B_hybrid()),
      P("claas_trion","Claas","TRION (Hybrid)", Arch("hybrid","APS Hybrid","Siebkasten"), L_hybrid({rotor:{min:500,max:1000,step:10,unit:"U/min",dp:0}}), B_hybrid()),
      P("claas_evion","Claas","EVION (Schüttler)", Arch("walker","Trommel + Schüttler","Siebkasten"), L_walker({rotor:{min:450,max:900,step:10,unit:"U/min",dp:0}}), B_walker())
    ],
    "John Deere": [
      P("jd_s","John Deere","S / S7 (konventionell)", Arch("walker","Trommel + Schüttler","Siebkasten"), L_walker({rotor:{min:450,max:900,step:10,unit:"U/min",dp:0}}), B_walker()),
      P("jd_x9","John Deere","X9 (Rotor)", Arch("rotor_single","Rotor","High capacity shoe"), L_rotorSingle({rotor:{min:500,max:1050,step:10,unit:"U/min",dp:0}, fan:{min:750,max:1250,step:10,unit:"U/min",dp:0}}), B_rotorSingle())
    ]
  };
})();
