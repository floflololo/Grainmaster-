(function(){
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  const round = (v,p=0)=>{const m=10**p; return Math.round(v*m)/m;};

  const PROBLEMS = [
    { id:"loss_rear", group:"Verluste", title:"Heckverluste (Korn hinten)", hint:"Korn am Boden hinter der Maschine" },
    { id:"loss_sieve", group:"Verluste", title:"Siebverluste (Korn im Wind)", hint:"Korn wird aus dem Siebkasten geblasen" },
    { id:"flow_tailings", group:"Prozess/Fluss", title:"Rücklauf hoch", hint:"Tailings/Returns hoch" },
    { id:"flow_rotorload", group:"Prozess/Fluss", title:"Rotorlast am Limit", hint:"Stopfergefahr/Last hoch" },
    { id:"quality_dirty", group:"Kornqualität", title:"Korn unsauber", hint:"Spelzen/Grün im Tank" },
    { id:"quality_cracks", group:"Kornqualität", title:"Bruchkorn", hint:"Viele gebrochene Körner" },
    { id:"quality_unthreshed", group:"Kornqualität", title:"Unausgedroschen", hint:"Korn in Ähren/Schoten" },
    { id:"cond_wet_tough", group:"Bedingungen", title:"Zäh & feucht", hint:"Grün/zäh + hohe Feuchte" },
    { id:"cond_dry_brittle", group:"Bedingungen", title:"Sehr trocken", hint:"Bruchrisiko" },
    { id:"cond_lodged", group:"Bedingungen", title:"Lagerbestand", hint:"Einzug ungleichmäßig" }
  ];

  function sanitize(s, limits){
    const out = { ...s };
    for(const k of Object.keys(limits)){
      out[k] = clamp(Number(out[k] ?? 0), limits[k].min, limits[k].max);
    }
    if(out.lowerSieve > out.upperSieve) out.lowerSieve = Math.max(limits.lowerSieve.min, out.upperSieve - 0.5);
    return out;
  }

  function computeStart(machine, field){
    const base = (machine.baselines[field.crop] || machine.baselines.weizen);
    let s = { ...base };

    const y = Number(field.yieldT)||0;
    const m = Number(field.moisture)||0;
    const yDelta = y - 8;
    const mDelta = m - 14;

    s.fan += yDelta * 18;
    s.speed -= yDelta * 0.18;
    s.concaveRear -= yDelta * 0.12;

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

    const t = machine.architecture.type;
    if(t==="walker"){ s.speed -= 0.2; s.fan += 20; }
    if(t==="hybrid"){ s.rotor -= 20; }
    if(t==="rotor_single"){ s.rotor += 15; }

    return sanitize(s, machine.limits);
  }

  function applyDelta(s, delta){
    const out = { ...s };
    for(const [k,d] of Object.entries(delta)) out[k] = Number(out[k] ?? 0) + Number(d);
    return out;
  }

  function normalizeObs(obs){
    const o = { ...obs };
    for(const k of Object.keys(o)) o[k] = clamp(Number(o[k] ?? 0), 0, 10);
    return o;
  }

  function stabilityScore(obs){
    const o = normalizeObs(obs);
    const pen = o.rearLoss*6 + o.sieveLoss*6 + o.dirty*4 + o.cracks*3 + o.tailings*3 + o.rotorLoad*2;
    return clamp(Math.round(100 - pen), 0, 100);
  }

  function estimateThroughput(field, s){
    const speed = Number(s.speed)||0;
    const w = Number(field.headerWidth)||0;
    const y = Number(field.yieldT)||0;
    const hah = (speed*w)/10;
    return { hah, tph: hah*y };
  }

  function buildSteps(machine, field, settings, obs, selectedProblems, learningWeightFn){
    const t = machine.architecture.type;
    const o = normalizeObs(obs);
    const chosen = new Set(selectedProblems || []);

    // Auto: wenn nichts gewählt, nutze Sliderwerte
    if(chosen.size===0){
      if(o.rotorLoad>=8) chosen.add("flow_rotorload");
      if(o.rearLoss>=6) chosen.add("loss_rear");
      if(o.sieveLoss>=6) chosen.add("loss_sieve");
      if(o.tailings>=7) chosen.add("flow_tailings");
      if(o.dirty>=6) chosen.add("quality_dirty");
      if(o.cracks>=6) chosen.add("quality_cracks");
    }

    const archMul = (t==="walker") ? 0.85 : (t==="hybrid") ? 0.90 : (t==="rotor_twin") ? 1.00 : 1.05;
    const mult = (pid)=>{
      const w = clamp(Number(learningWeightFn?.(pid) ?? 0), -2, 2);
      return (1 + w*0.075) * archMul;
    };

    const steps = [];
    const add = (title, meta, delta, bullets, severity)=>{
      steps.push({ id: randId(), title, meta, delta, bullets, severity });
    };

    if(chosen.has("flow_rotorload")){
      const m = mult("flow_rotorload");
      add("Rotorlast stabilisieren","Stopfer vermeiden • Fluss beruhigen",
        { speed: -round(0.4*m,1), concaveFront: +round(0.6*m,1) },
        ["Erst Speed runter (stärkster Hebel).","Korb vorne leicht öffnen.","Dann 50–150 m prüfen."],
        "warn"
      );
    }

    if(chosen.has("loss_rear")){
      const m = mult("loss_rear");
      if(t==="walker"){
        add("Heckverluste senken (Schüttler)","Schuh/Schüttler entlasten",
          { speed: -round(0.4*m,1), rotor: +round(20*m,0) },
          ["Bei Schüttler: zuerst Speed reduzieren.","Trommel/Rotor moderat rauf – Bruch prüfen."],
          "bad"
        );
      } else {
        add("Heckverluste senken","Mehr Separation",
          { speed: -round(0.3*m,1), concaveRear: -round(0.6*m,1), rotor: +round(30*m,0) },
          ["Korb hinten enger = mehr Separation.","Rotor moderat rauf unterstützt Trennung."],
          "bad"
        );
      }
    }

    if(chosen.has("loss_sieve")){
      const m = mult("loss_sieve");
      add("Siebverluste senken","Korn im System halten",
        (t==="walker")
          ? { speed: -round(0.3*m,1), fan: -round(40*m,0), upperSieve: -round(0.6*m,1) }
          : { fan: -round(50*m,0), upperSieve: -round(0.8*m,1) },
        ["Gebläse runter reduziert Kornabflug.","Obersieb leicht schließen.","Wenn Rücklauf steigt: minimal öffnen."],
        "bad"
      );
    }

    if(chosen.has("flow_tailings")){
      const m = mult("flow_tailings");
      add("Rücklauf senken","Siebe fein öffnen / Luft stabil",
        { upperSieve: +round(0.5*m,1), lowerSieve: +round(0.3*m,1) },
        ["Rücklauf hoch: Siebe minimal öffnen.","Wenn Korn unsauber: eher Fan rauf als Siebe weit öffnen."],
        "warn"
      );
    }

    if(chosen.has("quality_dirty")){
      const m = mult("quality_dirty");
      add("Korn sauberer bekommen","Mehr Luft + Führung",
        { fan: +round(60*m,0), upperSieve: -round(0.6*m,1) },
        ["Fan rauf trennt Spreu/Grün besser.","Obersieb leicht schließen.","Wenn Verluste steigen: Fan zurück oder Speed runter."],
        "warn"
      );
    }

    if(chosen.has("quality_cracks")){
      const m = mult("quality_cracks");
      add("Bruchkorn reduzieren","Schonender dreschen",
        { rotor: -round(50*m,0), concaveFront: +round(1.0*m,1) },
        ["Rotor runter = weniger Bruch.","Korb vorne öffnen = weniger Aggressivität."],
        "warn"
      );
    }

    if(chosen.has("quality_unthreshed")){
      const m = mult("quality_unthreshed");
      add("Unausgedroschen reduzieren","Mehr Ausdrusch",
        { concaveFront: -round(0.8*m,1), rotor: +round(40*m,0) },
        ["Korb vorne enger + Rotor rauf.","In kleinen Schritten, Bruch beobachten."],
        "warn"
      );
    }

    if(chosen.has("cond_wet_tough")){
      add("Zäh & feucht (Guardrail)","Fluss sichern",{ rotor:+20, speed:-0.2 },
        ["Rotor moderat rauf, Speed runter.","Nicht zu aggressiv am Korb."],"good");
    }
    if(chosen.has("cond_dry_brittle")){
      add("Sehr trocken (Guardrail)","Bruch vermeiden",{ rotor:-20, concaveFront:+0.5 },
        ["Aggressivität runter.","Wenn Ausdrusch leidet: minimal zurück."],"good");
    }
    if(chosen.has("cond_lodged")){
      add("Lagerbestand (Guardrail)","Einzug stabilisieren",{ speed:-0.3 },
        ["Speed runter für gleichmäßigen Einzug.","Schneidwerk/Haspel mechanisch anpassen."],"warn");
    }

    // Clamp deltas
    const safe = steps.map(st=>{
      const preview = sanitize(applyDelta(settings, st.delta), machine.limits);
      const corrected = {};
      for(const k of Object.keys(st.delta)) corrected[k] = preview[k] - settings[k];
      return { ...st, delta: corrected };
    });

    const sevRank = { bad:0, warn:1, good:2 };
    safe.sort((a,b)=> sevRank[a.severity]-sevRank[b.severity]);
    return safe.slice(0,6);
  }

  function randId(){
    try{
      const a = new Uint32Array(2);
      crypto.getRandomValues(a);
      return [...a].map(x=>x.toString(16)).join("");
    }catch{
      return String(Math.random()).slice(2) + String(Date.now());
    }
  }

  window.AdvisorEngine = {
    PROBLEMS,
    sanitize,
    computeStart,
    applyDelta,
    normalizeObs,
    stabilityScore,
    estimateThroughput,
    buildSteps
  };
})();
