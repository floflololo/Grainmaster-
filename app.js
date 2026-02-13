(function(){
  const $ = (id)=>document.getElementById(id);
  const STORAGE_KEY = "grainmaster_v4_superlearning";

  const clone = (x)=>JSON.parse(JSON.stringify(x));
  const esc = (s)=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  const round = (v,p=0)=>{const m=10**p; return Math.round(v*m)/m;};

  window.addEventListener("error", (e)=> alert("App-Fehler: " + (e.message || e.error || "Unbekannt")));
  window.addEventListener("unhandledrejection", (e)=> alert("Promise-Fehler: " + (e.reason?.message || e.reason || "Unbekannt")));

  // Muss zu machine-data.js passen
  const SET_KEYS = ["rotor","concaveFront","concaveRear","fan","upperSieve","lowerSieve","speed"];

  const DEFAULT = {
    machine: { brand:null, modelId:null },
    field: { crop:"weizen", mode:"balanced", yieldT:8, moisture:14, straw:"normal", green:"low", headerWidth:12.2, notes:"" },
    obs: { rearLoss:2, sieveLoss:2, tailings:3, rotorLoad:4, cracks:1, dirty:2 },
    selectedProblems: [],
    settings: null,
    steps: [],
    learning: {},   // problem learning -2..2

    // ✅ SUPER LEARNING: Aggregierte Statistiken (zählt ALLE male, nicht nur letzte 5)
    // stats[key] = { nAll, sumAll{...}, nRated, sumRated{...}, lastTs }
    stats: {},

    // ✅ optional: Verlauf (nur zur Transparenz/Export, nicht fürs Lernen notwendig)
    // wir halten den Verlauf groß, aber nicht unendlich (Speicher)
    history: [],

    // ✅ “letzte Situation” zum Bewerten (Feedback)
    lastRun: null, // { key, ts, settings, selectedProblems, obs, field }

    ui: {
      autoRecalc: true,
      manualDirty: false
    }
  };

  let state = load() || clone(DEFAULT);
  let deferredPrompt = null;

  document.addEventListener("DOMContentLoaded", init);

  function init(){
    if(!window.MACHINE_DB) { alert("MACHINE_DB fehlt (machine-data.js)"); return; }
    if(!window.AdvisorEngine) { alert("AdvisorEngine fehlt (advisor-engine.js)"); return; }

    setupPWA();
    setupSW();

    // Header
    $("btnReset").addEventListener("click", ()=>{
      if(!confirm("Wirklich Reset? Alles wird gelöscht.")) return;
      state = clone(DEFAULT);
      save();
      location.reload();
    });

    $("btnExport").addEventListener("click", openExport);
    $("btnImport").addEventListener("click", openImport);
    $("btnImportApply").addEventListener("click", (e)=>{ e.preventDefault(); doImport(); $("dlgImport").close(); });
    $("btnCopy").addEventListener("click", (e)=>{ e.preventDefault(); navigator.clipboard?.writeText($("exportText").value); setStatus("Kopiert"); });
    $("btnDownload").addEventListener("click", (e)=>{ e.preventDefault(); downloadExport(); });

    // Scroll
    $("btnScrollAdvisor").addEventListener("click", ()=> $("panelAdvisor").scrollIntoView({behavior:"smooth"}));
    $("btnScrollTop").addEventListener("click", ()=> window.scrollTo({top:0, behavior:"smooth"}));

    // Auto-Startwerte Toggle
    $("autoRecalc").checked = !!state.ui.autoRecalc;
    $("autoRecalc").addEventListener("change", ()=>{
      state.ui.autoRecalc = $("autoRecalc").checked;
      save();
      setStatus(state.ui.autoRecalc ? "Auto-Startwerte: AN" : "Auto-Startwerte: AUS");
    });

    // Reset manuell -> zurück zu Auto/Personal
    $("btnResetManual").addEventListener("click", ()=>{
      state.ui.manualDirty = false;
      state.steps = [];
      computeStartwerte();         // nutzt super learning
      computeStepsIfWanted();      // falls Probleme gewählt, sofort neu berechnen
      renderAll();
      setStatus("Manuell zurückgesetzt → Personal-Startwerte aktiv");
      $("panelAdvisor").scrollIntoView({behavior:"smooth"});
    });

    // Machine selects
    fillBrand();
    restoreMachine();

    $("brand").addEventListener("change", ()=>{
      fillModel();
      const list = window.MACHINE_DB[$("brand").value] || [];
      $("model").value = list[0]?.id || "";
      syncMachineFromUI();
      onMachineChanged();
    });

    $("model").addEventListener("change", ()=>{
      syncMachineFromUI();
      onMachineChanged();
    });

    // Feldprofil
    const fieldIds = ["crop","mode","yieldT","moisture","straw","green","headerWidth","notes"];
    fieldIds.forEach(id=>{
      $(id).addEventListener("change", ()=>{
        syncFieldFromUI();

        if(id==="crop"){
          state.selectedProblems = [];
          state.steps = [];
        }

        // ✅ automatisch Startwerte neu, solange Nutzer nicht manuell "dirty" ist
        if(state.ui.autoRecalc && !state.ui.manualDirty && id !== "notes"){
          computeStartwerte();
        }

        // ✅ wenn Probleme gewählt: Lösungen sofort aktualisieren
        computeStepsIfWanted();

        save();
        renderAll();
        const extra = (state.ui.autoRecalc && !state.ui.manualDirty && id!=="notes") ? " • Startwerte aktualisiert" : "";
        setStatus("Profil gespeichert" + extra);
      });
    });

    // Problems UI
    renderProblems();
    $("btnClearProblems").addEventListener("click", ()=>{
      state.selectedProblems = [];
      state.steps = [];
      save();
      renderProblems();
      renderSteps();
      renderProblemsPill();
      setStatus("Probleme gelöscht");
    });

    // Buttons
    $("btnStartwerte").addEventListener("click", ()=>{
      state.ui.manualDirty = false;
      computeStartwerte();
      computeStepsIfWanted();
      renderAll();
      setStatus("Startwerte berechnet (Learning)");
      $("panelAdvisor").scrollIntoView({behavior:"smooth"});
    });

    // Der Button bleibt als “manuell neu rechnen”, aber ist nicht mehr nötig
    $("btnVorschlaege").addEventListener("click", ()=>{
      computeStepsForce();
      save();
      renderSteps();
      setStatus(`${state.steps.length} Vorschlag/Vorschläge`);
      $("panelAdvisor").scrollIntoView({behavior:"smooth"});
    });

    // Obs sliders
    bindRange("rearLoss","rearLossVal");
    bindRange("sieveLoss","sieveLossVal");
    bindRange("tailings","tailingsVal");
    bindRange("rotorLoad","rotorLoadVal");
    bindRange("cracks","cracksVal");
    bindRange("dirty","dirtyVal");

    ["rearLoss","sieveLoss","tailings","rotorLoad","cracks","dirty"].forEach(id=>{
      $(id).addEventListener("input", ()=>{
        syncObsFromUI();
        save();
        renderStability();

        // ✅ wenn Probleme gewählt: Lösungen sofort aktualisieren
        computeStepsIfWanted();
        renderSteps();
      });
    });

    // Feedback => bewertet letzten Run + lernt stärker
    $("btnBetter").addEventListener("click", ()=>feedback(+1));
    $("btnSame").addEventListener("click", ()=>feedback(0));
    $("btnWorse").addEventListener("click", ()=>feedback(-1));

    // Hydrate UI
    hydrateFieldUI();
    hydrateObsUI();
    onMachineChanged(true);
  }

  // ---------- Status ----------
  function setStatus(t){ $("statusPill").textContent = t; }

  // ---------- Machine helpers ----------
  function brands(){ return Object.keys(window.MACHINE_DB).sort(); }

  function fillBrand(){
    const b = brands();
    $("brand").innerHTML = b.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
  }

  function fillModel(){
    const brand = $("brand").value;
    const list = window.MACHINE_DB[brand] || [];
    $("model").innerHTML = list.map(m=>`<option value="${esc(m.id)}">${esc(m.model)}</option>`).join("");
  }

  function restoreMachine(){
    const b = brands();
    const brand = (state.machine.brand && b.includes(state.machine.brand)) ? state.machine.brand : b[0];
    $("brand").value = brand;
    fillModel();

    const list = window.MACHINE_DB[brand] || [];
    const exists = list.some(m=>m.id===state.machine.modelId);
    $("model").value = exists ? state.machine.modelId : (list[0]?.id || "");
    syncMachineFromUI();
    updateSummary();
  }

  function syncMachineFromUI(){
    state.machine.brand = $("brand").value || null;
    state.machine.modelId = $("model").value || null;
    updateSummary();
    save();
  }

  function updateSummary(){
    const m = getMachineSafe();
    $("machineSummary").value = m ? m.summary : "";
  }

  function getMachineSafe(){
    const brand = state.machine.brand;
    const id = state.machine.modelId;
    const list = window.MACHINE_DB[brand] || [];
    return list.find(x=>x.id===id) || null;
  }

  function getMachine(){
    const m = getMachineSafe();
    if(!m) throw new Error("Maschinenprofil fehlt");
    return m;
  }

  function onMachineChanged(first=false){
    updateSummary();
    state.steps = [];
    state.selectedProblems = [];
    state.ui.manualDirty = false;

    computeStartwerte();      // nutzt Learning (all-time stats)
    renderProblems();
    computeStepsIfWanted();
    renderAll();

    setStatus(first ? "Bereit" : "Maschine angepasst (Learning geladen)");
  }

  // ---------- Field / Obs ----------
  function hydrateFieldUI(){
    $("crop").value = state.field.crop;
    $("mode").value = state.field.mode;
    $("yieldT").value = state.field.yieldT;
    $("moisture").value = state.field.moisture;
    $("straw").value = state.field.straw;
    $("green").value = state.field.green;
    $("headerWidth").value = state.field.headerWidth;
    $("notes").value = state.field.notes;
  }

  function syncFieldFromUI(){
    state.field.crop = $("crop").value;
    state.field.mode = $("mode").value;
    state.field.yieldT = Number($("yieldT").value);
    state.field.moisture = Number($("moisture").value);
    state.field.straw = $("straw").value;
    state.field.green = $("green").value;
    state.field.headerWidth = Number($("headerWidth").value);
    state.field.notes = $("notes").value || "";
  }

  function hydrateObsUI(){
    $("rearLoss").value = state.obs.rearLoss;
    $("sieveLoss").value = state.obs.sieveLoss;
    $("tailings").value = state.obs.tailings;
    $("rotorLoad").value = state.obs.rotorLoad;
    $("cracks").value = state.obs.cracks;
    $("dirty").value = state.obs.dirty;

    ["rearLoss","sieveLoss","tailings","rotorLoad","cracks","dirty"].forEach(id=>{
      const lab = $(id+"Val");
      if(lab) lab.textContent = String($(id).value);
    });
  }

  function syncObsFromUI(){
    state.obs.rearLoss = Number($("rearLoss").value);
    state.obs.sieveLoss = Number($("sieveLoss").value);
    state.obs.tailings = Number($("tailings").value);
    state.obs.rotorLoad = Number($("rotorLoad").value);
    state.obs.cracks = Number($("cracks").value);
    state.obs.dirty = Number($("dirty").value);
  }

  // ---------- SUPER LEARNING (All-time) ----------
  function statsKey(machineId, crop){ return `${machineId}|${crop}`; }

  function ensureStats(key){
    state.stats = (state.stats && typeof state.stats==="object") ? state.stats : {};
    if(!state.stats[key]){
      const sumAll = {}; const sumRated = {};
      SET_KEYS.forEach(k=>{ sumAll[k]=0; sumRated[k]=0; });
      state.stats[key] = { nAll:0, sumAll, nRated:0, sumRated, lastTs:0 };
    }
    // Migration safety: missing keys
    SET_KEYS.forEach(k=>{
      state.stats[key].sumAll[k] ??= 0;
      state.stats[key].sumRated[k] ??= 0;
    });
    return state.stats[key];
  }

  function pickSettings(s){
    const out = {};
    SET_KEYS.forEach(k=> out[k] = Number(s?.[k] ?? 0));
    return out;
  }

  // ✅ zählt JEDES Mal (auch manuelle Änderungen), als “All” (unbewertet)
  function learnUnrated(machine, crop, settings){
    const key = statsKey(machine.id, crop);
    const st = ensureStats(key);
    const x = pickSettings(settings);

    st.nAll += 1;
    SET_KEYS.forEach(k=> st.sumAll[k] += x[k]);
    st.lastTs = Date.now();
  }

  // ✅ Feedback => stärkeres Lernen (Rated)
  function learnRated(machine, crop, settings, rating){
    // rating: +1 better, 0 same, -1 worse
    const key = statsKey(machine.id, crop);
    const st = ensureStats(key);
    const x = pickSettings(settings);

    // Gewicht: better=2.0, same=1.0, worse=0.4 (worse fließt weniger ein, aber nicht 0)
    const w = (rating === 1) ? 2.0 : (rating === 0) ? 1.0 : 0.4;

    st.nRated += w;
    SET_KEYS.forEach(k=> st.sumRated[k] += x[k] * w);
    st.lastTs = Date.now();
  }

  function meanFromSum(sum, n){
    const out = {};
    SET_KEYS.forEach(k=> out[k] = sum[k] / n);
    return out;
  }

  function getPersonalBaseline(machine, crop){
    const key = statsKey(machine.id, crop);
    const st = state.stats?.[key];
    if(!st) return null;

    // Wenn es KEINE Daten gibt -> null
    const hasAll = (st.nAll && st.nAll >= 1);
    const hasRated = (st.nRated && st.nRated >= 1);
    if(!hasAll && !hasRated) return null;

    // Mean berechnen
    const meanAll = hasAll ? meanFromSum(st.sumAll, st.nAll) : null;
    const meanRated = hasRated ? meanFromSum(st.sumRated, st.nRated) : null;

    // Blend: wenn Rated vorhanden -> bevorzugen, sonst All
    let blended = meanAll || meanRated;
    if(meanAll && meanRated){
      // je mehr rated, desto mehr gewicht
      const alpha = clamp(0.35 + 0.10 * Math.min(6, st.nRated), 0.35, 0.85);
      blended = {};
      SET_KEYS.forEach(k=>{
        blended[k] = meanAll[k]*(1-alpha) + meanRated[k]*alpha;
      });
    }

    return AdvisorEngine.sanitize(blended, machine.limits);
  }

  // ---------- Startwerte (Auto + Learning) ----------
  function computeStartwerte(){
    syncFieldFromUI();
    const m = getMachine();

    const base = AdvisorEngine.computeStart(m, state.field);
    const personal = getPersonalBaseline(m, state.field.crop);

    let final = base;
    if(personal){
      // Alpha abhängig von Datenmenge
      const key = statsKey(m.id, state.field.crop);
      const st = state.stats?.[key];
      const n = st ? (st.nAll + st.nRated) : 0;
      const alpha = clamp(0.20 + 0.06 * Math.min(20, n), 0.20, 0.70);
      final = { ...base };
      SET_KEYS.forEach(k=> final[k] = base[k]*(1-alpha) + personal[k]*alpha);
    }

    state.settings = AdvisorEngine.sanitize(final, m.limits);

    // ✅ “run snapshot” aktualisieren (für späteres Feedback)
    stampLastRun();

    save();
  }

  function ensureSettings(){
    if(!state.settings) computeStartwerte();
  }

  // ---------- Auto-Suggestions (sofort) ----------
  function computeStepsIfWanted(){
    // Nur wenn Probleme ausgewählt sind (dein Wunsch: “Problem klicken -> Lösung steht sofort da”)
    if(!state.selectedProblems || state.selectedProblems.length === 0){
      state.steps = [];
      stampLastRun(); // trotzdem snapshot aktualisieren
      return;
    }
    computeStepsForce();
  }

  function computeStepsForce(){
    ensureSettings();
    syncFieldFromUI();
    syncObsFromUI();
    const m = getMachine();

    state.steps = AdvisorEngine.buildSteps(
      m, state.field, state.settings, state.obs, state.selectedProblems,
      (pid)=>getLearningWeight(m.id, state.field.crop, pid)
    );

    stampLastRun();
  }

  // ---------- Render ----------
  function renderAll(){
    renderProblemsPill();
    renderCards();
    renderSteps();
    renderTuning();
    renderStability();
    renderChecklist();
  }

  // Problems UI
  function renderProblems(){
    const groups = groupBy(AdvisorEngine.PROBLEMS, p=>p.group);
    const container = $("problemGroups");
    container.innerHTML = "";

    Object.entries(groups).forEach(([gname, items])=>{
      const g = document.createElement("div");
      g.className = "group";
      g.innerHTML = `<div class="gt">${esc(gname)}</div>`;
      const chips = document.createElement("div");
      chips.className = "chips";

      items.forEach(item=>{
        const btn = document.createElement("button");
        btn.type="button";
        btn.className = "chip" + (state.selectedProblems.includes(item.id) ? " active" : "");
        btn.title = item.hint;
        btn.textContent = item.title;

        btn.addEventListener("click", ()=>{
          toggleProblem(item.id);
          btn.classList.toggle("active");

          // ✅ Sofort Vorschläge erzeugen (ohne Button)
          computeStepsIfWanted();
          save();
          renderSteps();
          setStatus("Probleme aktualisiert → Lösung aktualisiert");
        });

        chips.appendChild(btn);
      });

      g.appendChild(chips);
      container.appendChild(g);
    });

    renderProblemsPill();
  }

  function toggleProblem(id){
    const set = new Set(state.selectedProblems);
    if(set.has(id)) set.delete(id); else set.add(id);
    state.selectedProblems = Array.from(set);
  }

  function renderProblemsPill(){
    $("problemsPill").textContent = `${state.selectedProblems.length} gewählt`;
  }

  // Cards
  function renderCards(){
    ensureSettings();
    const m = getMachine();
    const s = state.settings;
    const tp = AdvisorEngine.estimateThroughput(state.field, s);

    const cards = [
      card("Rotor/Trommel", `${round(s.rotor,0)} ${m.limits.rotor.unit}`, tagRotor(m, s.rotor)),
      card("Korb vorne", `${round(s.concaveFront,1)} ${m.limits.concaveFront.unit}`, {text:"Korb", level:"good", hint:""}),
      card("Korb hinten", `${round(s.concaveRear,1)} ${m.limits.concaveRear.unit}`, {text:"Korb", level:"good", hint:""}),
      card("Gebläse", `${round(s.fan,0)} ${m.limits.fan.unit}`, tagFan(s.fan)),
      card("Obersieb", `${round(s.upperSieve,1)} ${m.limits.upperSieve.unit}`, {text:"Sieb", level:"good", hint:""}),
      card("Untersieb", `${round(s.lowerSieve,1)} ${m.limits.lowerSieve.unit}`, {text:"Sieb", level:"good", hint:""}),
      card("Geschwindigkeit", `${round(s.speed,1)} ${m.limits.speed.unit}`, tagSpeed(s.speed)),
      card("Durchsatz", `${round(tp.tph,1)} t/h`, {text:"Orientierung", level:"good", hint:""})
    ];
    $("cards").innerHTML = cards.join("");
  }

  // Steps
  function renderSteps(){
    const steps = state.steps || [];
    $("stepPill").textContent = `${steps.length} Schritt(e)`;

    if(!steps.length){
      $("steps").innerHTML = `<div class="hint">Wähle Probleme – dann erscheinen die Lösungen sofort. (Oder nutze „Vorschläge“.)</div>`;
      return;
    }

    $("steps").innerHTML = steps.map((st, idx)=>{
      const changes = Object.entries(st.delta).map(([k,d])=>`${k}: ${d>0?"+":""}${formatDelta(d)}`).join(" • ");
      return `
        <div class="step">
          <div class="head">
            <div>
              <div class="title">Schritt ${idx+1}: ${esc(st.title)}</div>
              <div class="meta">${esc(st.meta)}</div>
              <div class="kv">${esc(changes)}</div>
            </div>
            <div class="tag ${esc(st.severity)}">${esc(sevLabel(st.severity))}</div>
          </div>
          <ul>${st.bullets.map(b=>`<li>${esc(b)}</li>`).join("")}</ul>
          <div class="controls">
            <button class="btn primary" data-apply="${st.id}">Anwenden</button>
            <button class="btn ghost" data-skip="${st.id}">Überspringen</button>
          </div>
        </div>
      `;
    }).join("");

    $("steps").querySelectorAll("button[data-apply]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.getAttribute("data-apply");
        applyStep(id);
      });
    });

    $("steps").querySelectorAll("button[data-skip]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.getAttribute("data-skip");
        state.steps = state.steps.filter(s=>s.id!==id);
        stampLastRun();
        save();
        renderSteps();
      });
    });
  }

  function applyStep(stepId){
    ensureSettings();
    const m = getMachine();
    const step = state.steps.find(s=>s.id===stepId);
    if(!step) return;

    state.ui.manualDirty = true;
    state.settings = AdvisorEngine.applyDelta(state.settings, step.delta);
    state.settings = AdvisorEngine.sanitize(state.settings, m.limits);
    state.steps = state.steps.filter(s=>s.id!==stepId);

    // ✅ Jede Änderung zählt ins Learning (unrated)
    learnUnrated(m, state.field.crop, state.settings);
    pushHistory("apply_step");

    // Vorschläge sofort neu berechnen (weil Ausgangslage jetzt anders)
    computeStepsIfWanted();

    stampLastRun();
    save();
    renderAll();
    setStatus("Angewendet – Learning merkt es (unbewertet)");
  }

  // Tuning
  function renderTuning(){
    ensureSettings();
    const m = getMachine();
    const lim = m.limits;
    const container = $("tuning");
    container.innerHTML = "";

    const keys = [
      ["Rotor/Trommel","rotor"],
      ["Korb vorne","concaveFront"],
      ["Korb hinten","concaveRear"],
      ["Gebläse","fan"],
      ["Obersieb","upperSieve"],
      ["Untersieb","lowerSieve"],
      ["Geschwindigkeit","speed"]
    ];

    keys.forEach(([label, key])=>{
      container.appendChild(makeTune(label, key, lim[key]));
    });
  }

  function makeTune(label, key, L){
    const wrap = document.createElement("div");
    wrap.className = "tune";

    const idR = `tr_${key}`;
    const idN = `tn_${key}`;

    wrap.innerHTML = `
      <div class="tune-top">
        <div class="tune-title">${esc(label)}</div>
        <div class="tune-val" id="tv_${esc(key)}"></div>
      </div>
      <div class="tune-row">
        <input id="${esc(idR)}" type="range" min="${L.min}" max="${L.max}" step="${L.step}">
        <input id="${esc(idN)}" type="number" min="${L.min}" max="${L.max}" step="${L.step}">
      </div>
    `;

    const r = wrap.querySelector(`#${idR}`);
    const n = wrap.querySelector(`#${idN}`);
    const tv = wrap.querySelector(`#tv_${key}`);

    const setLabel = ()=> tv.textContent = `${round(state.settings[key], L.dp)} ${L.unit}`;

    const setVal = (v)=>{
      const m = getMachine();
      state.ui.manualDirty = true;

      state.settings[key] = Number(v);
      state.settings = AdvisorEngine.sanitize(state.settings, m.limits);

      r.value = state.settings[key];
      n.value = state.settings[key];
      setLabel();

      // ✅ Learning zählt JEDES Mal (unrated)
      learnUnrated(m, state.field.crop, state.settings);
      pushHistory("manual");

      // ✅ Wenn Probleme gewählt: Lösungen sofort neu
      computeStepsIfWanted();

      stampLastRun();
      save();
      renderCards();
      renderChecklist();
      renderSteps();
      setStatus("Manuell geändert → Learning zählt (unbewertet)");
    };

    r.value = state.settings[key];
    n.value = state.settings[key];
    setLabel();

    r.addEventListener("input", ()=>setVal(r.value));
    n.addEventListener("change", ()=>setVal(n.value));

    return wrap;
  }

  function renderStability(){
    const score = AdvisorEngine.stabilityScore(state.obs);
    let label = `Stabilität: ${score}/100`;
    if(score >= 78) label += " • gut";
    else if(score >= 55) label += " • mittel";
    else label += " • kritisch";
    $("stabilityPill").textContent = label;
  }

  function renderChecklist(){
    ensureSettings();
    const m = getMachine();
    const s = state.settings;
    const o = AdvisorEngine.normalizeObs(state.obs);

    const rows = [];
    rows.push(checkRow("good","Maschine",`${m.brand} ${m.model}`));
    rows.push(checkRow("good","Aufbau",`${m.architecture.threshSystem}`));

    if(s.lowerSieve > s.upperSieve) rows.push(checkRow("bad","Plausibilität","Untersieb > Obersieb – Untersieb kleiner stellen."));
    else rows.push(checkRow("good","Plausibilität","Siebe plausibel."));

    if(o.rearLoss>=7) rows.push(checkRow("bad","Heckverluste hoch","Speed runter, Separation erhöhen (Korb hinten enger / Rotor moderat rauf)."));
    else if(o.rearLoss>=5) rows.push(checkRow("warn","Heckverluste auffällig","In kleinen Schritten korrigieren."));
    else rows.push(checkRow("good","Heckverluste","OK."));

    if(o.sieveLoss>=7) rows.push(checkRow("bad","Siebverluste hoch","Fan runter / Obersieb leicht schließen, ggf. Speed runter."));
    else if(o.sieveLoss>=5) rows.push(checkRow("warn","Siebverluste auffällig","Reinigung feinbalancieren."));
    else rows.push(checkRow("good","Siebverluste","OK."));

    const key = statsKey(m.id, state.field.crop);
    const st = state.stats?.[key];
    const nAll = st?.nAll || 0;
    const nRated = st?.nRated || 0;
    if(nAll >= 5) rows.push(checkRow("good","Learning-Daten",`Gespeichert (unbewertet): ${Math.floor(nAll)} • Bewertet: ${Math.floor(nRated)} (gewichtet)`));
    else rows.push(checkRow("warn","Learning baut sich auf",`Noch wenige Daten für ${state.field.crop}. Jede Änderung zählt, Feedback macht’s stärker.`));

    rows.push(checkRow("good","Routine","Nach jeder Änderung 50–150 m prüfen: Kornprobe + Verluste."));

    $("checklist").innerHTML = rows.join("");
  }

  // ---------- Feedback / Problem-Learning ----------
  function lKey(machineId, crop, pid){ return `${machineId}|${crop}|${pid}`; }
  function getLearningWeight(machineId, crop, pid){ return Number(state.learning[lKey(machineId,crop,pid)] ?? 0); }

  function feedback(delta){
    const m = getMachine();
    const crop = state.field.crop;

    // Problem learning (-2..2)
    const sel = state.selectedProblems || [];
    sel.forEach(pid=>{
      const k = lKey(m.id, crop, pid);
      state.learning[k] = clamp((Number(state.learning[k] ?? 0) + delta), -2, 2);
    });

    // Rated learning: bewertet den aktuellen Settings-Stand (stärker)
    ensureSettings();
    learnRated(m, crop, state.settings, delta);

    // Verlauf
    pushHistory(delta === 1 ? "feedback_better" : delta === 0 ? "feedback_same" : "feedback_worse");

    // Snapshot
    stampLastRun();

    // Wenn Probleme gewählt: Lösungen sofort anpassen (learning weights ändern die Reihenfolge/Delta)
    computeStepsIfWanted();

    save();
    renderChecklist();
    renderSteps();

    setStatus(delta>0 ? "Feedback: besser ✅ (Learning stärker)" : delta<0 ? "Feedback: schlechter ⚠️ (Learning angepasst)" : "Feedback: gleich (Learning gespeichert)");
  }

  // ---------- Run snapshot / history ----------
  function stampLastRun(){
    const m = getMachineSafe();
    if(!m) return;
    state.lastRun = {
      key: statsKey(m.id, state.field.crop),
      ts: Date.now(),
      field: clone(state.field),
      obs: clone(state.obs),
      selectedProblems: clone(state.selectedProblems),
      settings: pickSettings(state.settings)
    };
  }

  function pushHistory(type){
    const m = getMachineSafe();
    if(!m) return;

    state.history = Array.isArray(state.history) ? state.history : [];
    state.history.push({
      ts: Date.now(),
      type,
      machineId: m.id,
      crop: state.field.crop,
      settings: pickSettings(state.settings),
      obs: clone(state.obs),
      problems: clone(state.selectedProblems)
    });

    // Nicht unendlich speichern (aber “jeder Run zählt” bleibt über stats!)
    const MAX = 350;
    if(state.history.length > MAX){
      state.history = state.history.slice(state.history.length - MAX);
    }
  }

  // ---------- Export/Import ----------
  function openExport(){
    const payload = { app:"grainmaster", exportedAt: new Date().toISOString(), state };
    $("exportText").value = JSON.stringify(payload, null, 2);
    $("dlgExport").showModal();
  }

  function downloadExport(){
    const text = $("exportText").value || "";
    const blob = new Blob([text], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grainmaster-export-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openImport(){
    $("importText").value = "";
    $("dlgImport").showModal();
  }

  function doImport(){
    const txt = $("importText").value.trim();
    if(!txt) return;
    try{
      const payload = JSON.parse(txt);
      if(!payload?.state) throw new Error("no state");
      state = payload.state;

      // migrations / safety
      state.stats = (state.stats && typeof state.stats==="object") ? state.stats : {};
      state.history = Array.isArray(state.history) ? state.history : [];
      state.learning = (state.learning && typeof state.learning==="object") ? state.learning : {};
      state.ui ??= { autoRecalc:true, manualDirty:false };

      save();
      location.reload();
    }catch{
      alert("Import fehlgeschlagen: ungültiger JSON.");
    }
  }

  // ---------- UI helpers ----------
  function card(k, v, tag){
    return `
      <div class="card">
        <div class="k">${esc(k)}</div>
        <div class="v">${esc(v)}</div>
        <div class="u">${esc(tag?.hint || "")}</div>
        <div class="tag ${esc(tag?.level || "good")}">${esc(tag?.text || "Advisor")}</div>
      </div>
    `;
  }
  function sevLabel(s){ return s==="bad"?"Kritisch":s==="warn"?"Achtung":"OK"; }
  function formatDelta(d){ return String(round(d, Number.isInteger(d)?0:1)); }

  function tagRotor(machine, v){
    const t = machine.architecture.type;
    if(t==="walker"){
      if(v>860) return {text:"Aggressiv", level:"warn", hint:"Bruch beobachten"};
      if(v<650) return {text:"Schonend", level:"good", hint:"Ausdrusch prüfen"};
      return {text:"Normal", level:"good", hint:"Stabil"};
    }
    if(v>980) return {text:"Aggressiv", level:"warn", hint:"Bruch beobachten"};
    if(v<680) return {text:"Schonend", level:"good", hint:"Ausdrusch prüfen"};
    return {text:"Normal", level:"good", hint:"Stabil"};
  }
  function tagFan(v){
    if(v>=1120) return {text:"Viel Luft", level:"warn", hint:"Siebverluste prüfen"};
    if(v<=740) return {text:"Wenig Luft", level:"warn", hint:"Kornsauberkeit prüfen"};
    return {text:"Stabil", level:"good", hint:"Reinigung stabil"};
  }
  function tagSpeed(v){
    if(v>=7.5) return {text:"Schnell", level:"warn", hint:"Verluste/Last prüfen"};
    if(v<=4.5) return {text:"Schonend", level:"good", hint:"Durchsatz geringer"};
    return {text:"Normal", level:"good", hint:"Stabil"};
  }

  function checkRow(stateClass, title, desc){
    return `
      <div class="check">
        <div class="dot ${stateClass}"></div>
        <div>
          <div class="t">${esc(title)}</div>
          <div class="d">${esc(desc)}</div>
        </div>
      </div>
    `;
  }

  function groupBy(arr, fn){
    const out = {};
    arr.forEach(x=>{
      const k = fn(x);
      out[k] ??= [];
      out[k].push(x);
    });
    return out;
  }

  function bindRange(rangeId, labelId){
    const r = $(rangeId);
    const l = $(labelId);
    const upd = ()=> l.textContent = String(r.value);
    r.addEventListener("input", upd);
    upd();
  }

  // ---------- Storage ----------
  function load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return null;
      const s = JSON.parse(raw);

      const merged = clone(DEFAULT);
      Object.assign(merged, s);

      merged.machine = Object.assign(clone(DEFAULT.machine), s.machine||{});
      merged.field = Object.assign(clone(DEFAULT.field), s.field||{});
      merged.obs = Object.assign(clone(DEFAULT.obs), s.obs||{});
      merged.selectedProblems = Array.isArray(s.selectedProblems) ? s.selectedProblems : [];
      merged.steps = Array.isArray(s.steps) ? s.steps : [];
      merged.learning = (s.learning && typeof s.learning==="object") ? s.learning : {};
      merged.stats = (s.stats && typeof s.stats==="object") ? s.stats : {};
      merged.history = Array.isArray(s.history) ? s.history : [];
      merged.lastRun = (s.lastRun && typeof s.lastRun==="object") ? s.lastRun : null;
      merged.ui = Object.assign(clone(DEFAULT.ui), s.ui||{});

      return merged;
    }catch{
      return null;
    }
  }
  function save(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch{} }

  // ---------- PWA ----------
  function setupPWA(){
    window.addEventListener("beforeinstallprompt",(e)=>{
      e.preventDefault();
      deferredPrompt = e;
      const b = $("btnInstall");
      if(b) b.hidden = false;
    });
    const btn = $("btnInstall");
    if(btn){
      btn.addEventListener("click", async ()=>{
        if(!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        btn.hidden = true;
      });
    }
  }

  function setupSW(){
    if(!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }
})();
