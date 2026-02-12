/* advisor-engine.js
   Engine: erzeugt Startwerte + Advisor-Schritte, abhängig von Maschinenprofil (Architektur + Limits + baselines)
*/

window.AdvisorEngine = (() => {
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  const round = (v,p=0)=>{const m=10**p; return Math.round(v*m)/m;};

  const PROBLEMS = [
    { id:"loss_rear", group:"Verluste", title:"Heckverluste (Korn hinten)", hint:"Korn am Boden hinter der Maschine" },
    { id:"loss_sieve", group:"Verluste", title:"Siebverluste (Korn im Wind)", hint:"Korn wird aus dem Siebkasten geblasen" },
    { id:"quality_dirty", group:"Kornqualität", title:"Korn unsauber", hint:"Spelzen/Grün im Korntank" },
    { id:"quality_cracks", group:"Kornqualität", title:"Bruchkorn", hint:"Viele gebrochene Körner" },
    { id:"quality_unthreshed", group:"Kornqualität", title:"Unausgedroschen", hint:"Körner in Ähren/Schoten" },
    { id:"flow_tailings", group:"Prozess/Fluss", title:"Rücklauf hoch", hint:"Tailings/Returns dauerhaft hoch" },
    { id:"flow_rotorload", group:"Prozess/Fluss", title:"Rotorlast am Limit", hint:"Stopfergefahr/Last sehr hoch" },
    { id:"cond_wet_tough", group:"Bedingungen", title:"Zäh & feucht", hint:"Grün/zäh + höhere Feuchte" },
    { id:"cond_dry_brittle", group:"Bedingungen", title:"Sehr trocken", hint:"Staub, brüchig, Bruchneigung" },
    { id:"cond_lodged", group:"Bedingungen", title:"Lagerbestand", hint:"Lager, ungleichmäßiger Einzug" }
  ];

  function defaultLearning(){
    // (brand/model/crop/problem) lernt separat, in app.js zusammengeführt
    return {};
  }

  function sanitize(s, limits){
    const out = { ...s };
    for(const k of Object.keys(limits)){
      out[k] = clamp(out[k], limits[k].min, limits[k].max);
    }
    if(out.lowerSieve > out.upperSieve) out.lowerSieve = Math.max(limits.lowerSieve.min, out.upperSieve - 0.5);
    return out;
  }

  function computeStart(machineProfile, field){
    const base = { ...(machineProfile.baselines[field.crop] || machineProfile.baselines.weizen) };
    let s = { ...base };

    const y = Number(field.yieldT)||0;
    const m = Number(field.moisture)||0;

    // allgemeine Korrekturen
    const yDelta = y - 8;
    s.fan += yDelta * 18;
    s.speed -= yDelta * 0.18;
    s.concaveRear -= yDelta * 0.12;

    const mDelta = m - 14;
    s.rotor += mDelta * 10;
    s.fan += mDelta * 12;
    s.concaveFront -= mDelta * 0.12;
    s.concaveRear  -= mDelta * 0.10;
    s.speed -= mDelta * 0.04;

    if(field.straw==="trocken"){ s.rotor-=40; s.concaveFront+=1.0; s.fan+=30; }
    if(field.straw==="zäh"){ s.rotor+=60; s.concaveRear-=0.8; s.speed-=0.3; }
    if(field.straw==="lager"){ s.fan+=40; s.upperSieve-=0.5; s.speed-=0.4; }

    if(field.green==="med"){ s.fan+=40; s.upperSieve+=0.5; s.speed-=0.2; }
    if(field.green==="high"){ s.fan+=80; s.upperSieve+=1.0; s.lowerSieve+=0.5; s.speed-=0.5; }

    if(field.mode==="throughput"){ s.speed+=0.5; s.rotor+=40; s.concaveRear-=0.4; }
    if(field.mode==="clean"){ s.fan+=60; s.upperSieve-=1.0; s.lowerSieve-=0.5; }
    if(field.mode==="loss"){ s.speed-=0.6; s.concaveRear-=0.6; s.fan+=20; }

    // Architektur-Korrekturen
    const t = machineProfile.architecture.type;
    if(t==="walker"){
      // Schüttler: Reinigung/Shoe sensibler, Speed etwas konservativer
      s.speed -= 0.2;
      s.fan += 20;
    }
    if(t==="hybrid"){
      // APS/Hybrid: Vorabscheidung stark -> kleinere Änderungen
      s.rotor -= 20;
    }
    if(t==="rotor_single"){
      s.rotor += 15;
    }

    return sanitize(s, machineProfile.limits);
  }

  function buildSteps(machineProfile, field, settings, selectedProblems, learningKeyToWeight){
    const limits = machineProfile.limits;
    const arch = machineProfile.architecture.type;

    const chosen = new Set(selectedProblems || []);
    const steps = [];

    const mult = (pid) => {
      const w = clamp(Number(learningKeyToWeight(pid) || 0), -2, 2);
      // arch modifiers: walker smaller deltas, hybrid smaller, twin moderate
      const archMul =
        arch==="walker" ? 0.85 :
        arch==="hybrid" ? 0.90 :
        arch==="rotor_twin" ? 1.00 :
        1.05; // rotor_single slightly stronger
      return (1 + w*0.075) * archMul;
    };

    const add = (title, meta, delta, bullets, severity) => {
      steps.push({
        id: cryptoId(),
        title, meta,
        delta,
        bullets,
        severity
      });
    };

    // Step ordering: limit/flow -> losses -> quality -> conditions
    if(chosen.has("flow_rotorload")){
      const m = mult("flow_rotorload");
      add(
        "Last stabilisieren",
        "Stopfer vermeiden • Materialfluss beruhigen",
        {
          speed: -round(0.4*m,1),
          concaveFront: +round(0.6*m,1)
        },
        [
          "Speed ist der stärkste Hebel gegen Überlast.",
          "Korb vorne leicht öffnen stabilisiert den Fluss."
        ],
        "warn"
      );
    }

    if(chosen.has("loss_rear")){
      const m = mult("loss_rear");
      // walker: eher speed & cleaning entlasten statt zu aggressiv am Korb hinten
      if(arch==="walker"){
        add(
          "Heckverluste senken (Schüttler)",
          "Durchsatz runter • Trennung stabilisieren",
          { speed: -round(0.4*m,1), rotor: +round(20*m,0) },
          [
            "Bei Schüttler-Maschinen zuerst Speed reduzieren.",
            "Dreschintensität leicht erhöhen, aber Bruch beobachten."
          ],
          "bad"
        );
      } else {
        add(
          "Heckverluste senken",
          "Separation erhöhen",
          {
            speed: -round(0.3*m,1),
            concaveRear: -round(0.6*m,1),
            rotor: +round(30*m,0)
          },
          [
            "Korb hinten enger = mehr Separation.",
            "Rotor leicht rauf hilft Trennung. Danach prüfen (50–150 m)."
          ],
          "bad"
        );
      }
    }

    if(chosen.has("loss_sieve")){
      const m = mult("loss_sieve");
      add(
        "Siebverluste senken",
        "Korn im System halten",
        arch==="walker"
          ? { speed: -round(0.3*m,1), fan: -round(40*m,0), upperSieve: -round(0.6*m,1) }
          : { fan: -round(50*m,0), upperSieve: -round(0.8*m,1) },
        [
          "Gebläse runter reduziert Kornabflug.",
          "Obersieb leicht schließen.",
          "Wenn Rücklauf steigt: minimal öffnen."
        ],
        "bad"
      );
    }

    if(chosen.has("flow_tailings")){
      const m = mult("flow_tailings");
      add(
        "Rücklauf senken",
        "Siebe fein öffnen, Luftführung stabil",
        { upperSieve: +round(0.5*m,1), lowerSieve: +round(0.3*m,1) },
        [
          "Rücklauf hoch: Siebe minimal öffnen.",
          "Wenn Korn unsauber: lieber Fan rauf statt Siebe zu weit öffnen."
        ],
        "warn"
      );
    }

    if(chosen.has("quality_cracks")){
      const m = mult("quality_cracks");
      add(
        "Bruchkorn reduzieren",
        "Schonender dreschen",
        { rotor: -round(50*m,0), concaveFront: +round(1.0*m,1) },
        [
          "Rotor runter = weniger Bruch.",
          "Korb vorne öffnen reduziert Aggressivität."
        ],
        "warn"
      );
    }

    if(chosen.has("quality_unthreshed")){
      const m = mult("quality_unthreshed");
      add(
        "Unausgedroschen reduzieren",
        "Mehr Ausdrusch",
        { concaveFront: -round(0.8*m,1), rotor: +round(40*m,0) },
        [
          "Korb vorne enger + Rotor rauf erhöht Ausdrusch.",
          "In kleinen Schritten, Bruch beobachten."
        ],
        "warn"
      );
    }

    if(chosen.has("quality_dirty")){
      const m = mult("quality_dirty");
      // hybrid often cleans well -> smaller changes
      add(
        "Korn sauberer bekommen",
        "Mehr Luft, Siebführung",
        { fan: +round(60*m,0), upperSieve: -round(0.6*m,1) },
        [
          "Fan rauf trennt Spreu/Grün besser.",
          "Obersieb leicht schließen.",
          "Wenn Korn hinten rausfliegt: Fan zurück."
        ],
        "warn"
      );
    }

    if(chosen.has("cond_wet_tough")){
      add(
        "Zäh & feucht (Guardrail)",
        "Fluss sichern",
        { rotor: +20, speed: -0.2 },
        [
          "Bei zähem Material Fluss sichern: Rotor moderat rauf, Speed runter.",
          "Nicht zu aggressiv am Korb."
        ],
        "good"
      );
    }

    if(chosen.has("cond_dry_brittle")){
      add(
        "Sehr trocken (Guardrail)",
        "Bruch vermeiden",
        { rotor: -20, concaveFront: +0.5 },
        [
          "Trockenheit: Aggressivität runter.",
          "Wenn Ausdrusch leidet: minimal zurück."
        ],
        "good"
      );
    }

    if(chosen.has("cond_lodged")){
      add(
        "Lagerbestand (Guardrail)",
        "Einzug stabilisieren",
        { speed: -0.3 },
        [
          "Lager → gleichmäßiger Einzug: Speed runter.",
          "Schneidwerk/Haspel mechanisch anpassen."
        ],
        "warn"
      );
    }

    // Clamp deltas by preview + sanitize so steps never suggest nonsense
    const safeSteps = steps.map(st => {
      const preview = sanitize(applyDelta(settings, st.delta), limits);
      const corrected = {};
      for(const k of Object.keys(st.delta)){
        corrected[k] = preview[k] - settings[k];
      }
      return { ...st, delta: corrected };
    });

    // Sort severity
    const sevRank = { bad:0, warn:1, good:2 };
    safeSteps.sort((a,b)=> (sevRank[a.severity]-sevRank[b.severity]) );
    return safeSteps.slice(0,6);
  }

  function applyDelta(settings, delta){
    const s = { ...settings };
    for(const [k,d] of Object.entries(delta)){
      s[k] = (s[k] ?? 0) + d;
    }
    return s;
  }

  function estimateThroughput(field, s){
    const speed = Number(s.speed)||0;
    const w = Number(field.headerWidth)||0;
    const y = Number(field.yieldT)||0;
    const hah = (speed*w)/10;
    return { hah, tph: hah*y };
  }

  function stabilityScore(obs){
    const o = normalizeObs(obs);
    const pen = o.rearLoss*6 + o.sieveLoss*6 + o.dirty*4 + o.cracks*3 + o.tailings*3 + o.rotorLoad*2;
    return clamp(Math.round(100 - pen), 0, 100);
  }

  function normalizeObs(obs){
    const o = { ...obs };
    for(const k of Object.keys(o)) o[k] = clamp(Number(o[k])||0, 0, 10);
    return o;
  }

  function cryptoId(){
    try{
      const a = new Uint32Array(2);
      crypto.getRandomValues(a);
      return [...a].map(x=>x.toString(16)).join("");
    }catch{
      return String(Math.random()).slice(2) + String(Date.now());
    }
  }

  return {
    PROBLEMS,
    defaultLearning,
    sanitize,
    computeStart,
    buildSteps,
    applyDelta,
    estimateThroughput,
    stabilityScore,
    normalizeObs
  };
})();
