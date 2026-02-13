(function(){
  const $ = (id)=>document.getElementById(id);
  const STORAGE_KEY = "grainmaster_v5_fixed";

  const clone = (x)=>JSON.parse(JSON.stringify(x));
  const esc = (s)=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  const round = (v,p=0)=>{const m=10**p; return Math.round(v*m)/m;};

  // Crash-Schutz: Wenn doch ein Fehler passiert, siehst du es sofort.
  window.addEventListener("error", (e)=> alert("App-Fehler: " + (e.message || e.error || "Unbekannt")));
  window.addEventListener("unhandledrejection", (e)=> alert("Promise-Fehler: " + (e.reason?.message || e.reason || "Unbekannt")));

  const SET_KEYS = ["rotor","concaveFront","concaveRear","fan","upperSieve","lowerSieve","speed"];

  const DEFAULT = {
    machine: { brand:null, modelId:null },
    field: { crop:"weizen", mode:"balanced", yieldT:8, moisture:14, straw:"normal", green:"low", headerWidth:12.2, notes:"" },
    obs: { rearLoss:2, sieveLoss:2, tailings:3, rotorLoad:4, cracks:1, dirty:2 },
    selectedProblems: [],
    settings: null,
    steps: [],
    learning: {},
    stats: {},     // ✅ all-time aggregated learning
    history: [],   // optional log
    lastRun: null,
    ui: {
      autoRecalc: true,
      manualDirty: false
    }
  };

  let state = load() || clone(DEFAULT);
  let deferredPrompt = null;

  document.addEventListener("DOMContentLoaded", init);

  function init(){
    try{
      if(!window.MACHINE_DB) { alert("MACHINE_DB fehlt (machine-data.js)"); return; }
      if(!window.AdvisorEngine) { alert("AdvisorEngine fehlt (advisor-engine.js)"); return; }

      // Grund-IDs prüfen (hilft dir, falls index.html noch alt ist)
      const must = ["brand","model","crop","mode","yieldT","moisture","straw","green","headerWidth","notes","cards","steps","tuning","checklist","problemGroups"];
      const missing = must.filter(id => !$(id));
      if(missing.length){
        alert("index.html ist nicht aktuell oder IDs fehlen:\n" + missing.join(", ") + "\n\nBitte das index.html aus dem letzten Update verwenden.");
        // Trotzdem versuchen wir weiterzulaufen soweit es geht.
      }

      setupPWA();
      setupSW();

      // Header Buttons (alle guarded)
      onClick("btnReset", ()=>{
        if(!confirm("Wirklich Reset? Alles wird gelöscht.")) return;
        state = clone(DEFAULT);
        save();
        location.reload();
      });
      onClick("btnExport", openExport);
      onClick("btnImport", openImport);
      onClick("btnImportApply", (e)=>{ e?.preventDefault?.(); doImport(); safeClose("dlgImport"); });
      onClick("btnCopy", (e)=>{ e?.preventDefault?.(); navigator.clipboard?.writeText($("exportText")?.value || ""); setStatus("Kopiert"); });
      onClick("btnDownload", (e)=>{ e?.preventDefault?.(); downloadExport(); });

      // Scroll Buttons
      onClick("btnScrollAdvisor", ()=> $("panelAdvisor")?.scrollIntoView({behavior:"smooth"}));
      onClick("btnScrollTop", ()=> window.scrollTo({top:0, behavior:"smooth"}));

      // ✅ Auto-Recalc Toggle (guarded -> Fix für deinen Fehler)
      const auto = $("autoRecalc");
      if(auto){
        auto.checked = !!state.ui.autoRecalc;
        auto.addEventListener("change", ()=>{
          state.ui.autoRecalc = !!auto.checked;
          save();
          setStatus(state.ui.autoRecalc ? "Auto-Startwerte: AN" : "Auto-Startwerte: AUS");
        });
      }

      // ✅ Reset Manuell (optional)
      onClick("btnResetManual", ()=>{
        state.ui.manualDirty = false;
        state.steps = [];
        computeStartwerte();
        computeStepsIfWanted();
        renderAll();
        setStatus("Manuell zurückgesetzt → Personal-Startwerte aktiv");
        $("panelAdvisor")?.scrollIntoView({behavior:"smooth"});
      });

      // Machine selects (wichtig: erst füllen, dann Listener)
      fillBrand();
      restoreMachine();

      $("brand")?.addEventListener("change", ()=>{
        fillModel();
        const list = window.MACHINE_DB[$("brand")?.value] || [];
        if($("model")) $("model").value = list[0]?.id || "";
        syncMachineFromUI();
        onMachineChanged();
      });

      $("model")?.addEventListener("change", ()=>{
        syncMachineFromUI();
        onMachineChanged();
      });

      // Field inputs
      const fieldIds = ["crop","mode","yieldT","moisture","straw","green","headerWidth","notes"];
      fieldIds.forEach(id=>{
        $(id)?.addEventListener("change", ()=>{
          syncFieldFromUI();

          if(id==="crop"){
            state.selectedProblems = [];
            state.steps = [];
          }

          if(state.ui.autoRecalc && !state.ui.manualDirty && id !== "notes"){
            computeStartwerte();
          }

          computeStepsIfWanted();
          save();
          renderAll();
          const extra = (state.ui.autoRecalc && !state.ui.manualDirty && id!=="notes") ? " • Startwerte aktualisiert" : "";
          setStatus("Profil gespeichert" + extra);
        });
      });

      // Problems
      renderProblems();
      onClick("btnClearProblems", ()=>{
        state.selectedProblems = [];
        state.steps = [];
        save();
        renderProblems();
        renderSteps();
        renderProblemsPill();
        setStatus("Probleme gelöscht");
      });

      // Buttons
      onClick("btnStartwerte", ()=>{
        state.ui.manualDirty = false;
        computeStartwerte();
        computeStepsIfWanted();
        renderAll();
        setStatus("Startwerte berechnet (Learning)");
        $("panelAdvisor")?.scrollIntoView({behavior:"smooth"});
      });

      // Button bleibt optional
      onClick("btnVorschlaege", ()=>{
        computeStepsForce();
        save();
        renderSteps();
        setStatus(`${state.steps.length} Vorschlag/Vorschläge`);
        $("panelAdvisor")?.scrollIntoView({behavior:"smooth"});
      });

      // Obs sliders
      bindRange("rearLoss","rearLossVal");
      bindRange("sieveLoss","sieveLossVal");
      bindRange("tailings","tailingsVal");
      bindRange("rotorLoad","rotorLoadVal");
      bindRange("cracks","cracksVal");
      bindRange("dirty","dirtyVal");

      ["rearLoss","sieveLoss","tailings","rotorLoad","cracks","dirty"].forEach(id=>{
        $(id)?.addEventListener("input", ()=>{
          syncObsFromUI();
          save();
          renderStability();
          computeStepsIfWanted();
          renderSteps();
        });
      });

      // Feedback
      onClick("btnBetter", ()=>feedback(+1));
      onClick("btnSame", ()=>feedback(0));
      onClick("btnWorse", ()=>feedback(-1));

      // Hydrate UI
      hydrateFieldUI();
      hydrateObsUI();

      // First render
      onMachineChanged(true);

    }catch(err){
      alert("Init-Fehler: " + (err?.message || err));
      console.error(err);
    }
  }

  // ---------- tiny helpers ----------
  function onClick(id, fn){
    const el = $(id);
    if(!el) return;
    el.addEventListener("click", fn);
  }
  function safeClose(id){
    const d = $(id);
    if(d?.close) d.close();
  }

  function setStatus(t){
    const pill = $("statusPill");
    if(pill) pill.textContent = t;
  }

  // ---------- Machine ----------
  function brands(){ return Object.keys(window.MACHINE_DB).sort(); }

  function fillBrand(){
    const el = $("brand");
    if(!el) return;
    const b = brands();
    el.innerHTML = b.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
  }

  function fillModel(){
    const el = $("model");
    const bEl = $("brand");
    if(!el || !bEl) return;
    const brand = bEl.value;
    const list = window.MACHINE_DB[brand] || [];
    el.innerHTML = list.map(m=>`<option value="${esc(m.id)}">${esc(m.model)}</option>`).join("");
  }

  function restoreMachine(){
    const bEl = $("brand");
    const mEl = $("model");
    if(!bEl || !mEl) return;

    const b = brands();
    const brand = (state.machine.brand && b.includes(state.machine.brand)) ? state.machine.brand : b[0];
    bEl.value = brand;

    fillModel();

    const list = window.MACHINE_DB[brand] || [];
    const exists = list.some(m=>m.id===state.machine.modelId);
    mEl.value = exists ? state.machine.modelId : (list[0]?.id || "");

    syncMachineFromUI();
    updateSummary();
  }

  function syncMachineFromUI(){
    const bEl = $("brand");
    const mEl = $("model");
    state.machine.brand = bEl?.value || null;
    state.machine.modelId = mEl?.value || null;
    updateSummary();
    save();
  }

  function updateSummary(){
    const out = $("machineSummary");
    if(!out) return;
    const m = getMachineSafe();
    out.value = m ? m.summary : "";
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

    // compute start values using learning
    computeStartwerte();

    renderProblems();
    computeStepsIfWanted();
    renderAll();

    setStatus(first ? "Bereit" : "Maschine angepasst");
  }

  // ---------- Field / Obs ----------
  function hydrateFieldUI(){
    setVal("crop", state.field.crop);
    setVal("mode", state.field.mode);
    setVal("yieldT", state.field.yieldT);
    setVal("moisture", state.field.moisture);
    setVal("straw", state.field.straw);
    setVal("green", state.field.green);
    setVal("headerWidth", state.field.headerWidth);
    setVal("notes", state.field.notes);
  }

  function setVal(id, v){
    const el = $(id);
    if(!el) return;
    el.value = v;
  }

  function syncFieldFromUI(){
    state.field.crop = $("crop")?.value || state.field.crop;
    state.field.mode = $("mode")?.value || state.field.mode;
    state.field.yieldT = Number($("yieldT")?.value ?? state.field.yieldT);
    state.field.moisture = Number($("moisture")?.value ?? state.field.moisture);
    state.field.straw = $("straw")?.value || state.field.straw;
    state.field.green = $("green")?.value || state.field.green;
    state.field.headerWidth = Number($("headerWidth")?.value ?? state.field.headerWidth);
    state.field.notes = $("notes")?.value || "";
  }

  function hydrateObsUI(){
    setVal("rearLoss", state.obs.rearLoss);
    setVal("sieveLoss", state.obs.sieveLoss);
    setVal("tailings", state.obs.tailings);
    setVal("rotorLoad", state.obs.rotorLoad);
    setVal("cracks", state.obs.cracks);
    setVal("dirty", state.obs.dirty);

    ["rearLoss","sieveLoss","tailings","rotorLoad","cracks","dirty"].forEach(id=>{
      const lab = $(id+"Val");
      const rng = $(id);
      if(lab && rng) lab.textContent = String(rng.value);
    });
  }

  function syncObsFromUI(){
    state.obs.rearLoss = Number($("rearLoss")?.value ?? state.obs.rearLoss);
    state.obs.sieveLoss = Number($("sieveLoss")?.value ?? state.obs.sieveLoss);
    state.obs.tailings = Number($("tailings")?.value ?? state.obs.tailings);
    state.obs.rotorLoad = Number($("rotorLoad")?.value ?? state.obs.rotorLoad);
    state.obs.cracks = Number($("cracks")?.value ?? state.obs.cracks);
    state.obs.dirty = Number($("dirty")?.value ?? state.obs.dirty);
  }

  // ---------- Learning (All-time stats) ----------
  function statsKey(machineId, crop){ return `${machineId}|${crop}`; }

  function ensureStats(key){
    state.stats = (state.stats && typeof state.stats==="object") ? state.stats : {};
    if(!state.stats[key]){
      const sumAll = {}; const sumRated = {};
      SET_KEYS.forEach(k=>{ sumAll[k]=0; sumRated[k]=0; });
      state.stats[key] = { nAll:0, sumAll, nRated:0, sumRated, lastTs:0 };
    }
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

  function learnUnrated(machine, crop, settings){
    const key = statsKey(machine.id, crop);
    const st = ensureStats(key);
    const x = pickSettings(settings);

    st.nAll += 1;
    SET_KEYS.forEach(k=> st.sumAll[k] += x[k]);
    st.lastTs = Date.now();
  }

  function learnRated(machine, crop, settings, rating){
    const key = statsKey(machine.id, crop);
    const st = ensureStats(key);
    const x = pickSettings(settings);

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

    const hasAll = st.nAll >= 1;
    const hasRated = st.nRated >= 1;
    if(!hasAll && !hasRated) return null;

    const meanAll = hasAll ? meanFromSum(st.sumAll, st.nAll) : null;
    const meanRated = hasRated ? meanFromSum(st.sumRated, st.nRated) : null;

    let blended = meanAll || meanRated;
    if(meanAll && meanRated){
      const alpha = clamp(0.35 + 0.10 * Math.min(6, st.nRated), 0.35, 0.85);
      blended = {};
      SET_KEYS.forEach(k=> blended[k] = meanAll[k]*(1-alpha) + meanRated[k]*alpha);
    }
    return AdvisorEngine.sanitize(blended, machine.limits);
  }

  // ---------- Startwerte ----------
  function computeStartwerte(){
    syncFieldFromUI();
    const m = getMachine();

    const base = AdvisorEngine.computeStart(m, state.field);
    const personal = getPersonalBaseline(m, state.field.crop);

    let final = base;
    if(personal){
      const key = statsKey(m.id, state.field.crop);
      const st = state.stats?.[key];
      const n = st ? (st.nAll + st.nRated) : 0;
      const alpha = clamp(0.20 + 0.06 * Math.min(20, n), 0.20, 0.70);
      final = { ...base };
      SET_KEYS.forEach(k=> final[k] = base[k]*(1-alpha) + personal[k]*alpha);
    }

    state.settings = AdvisorEngine.sanitize(final, m.limits);
    stampLastRun();
    save();
  }

  function ensureSettings(){
    if(!state.settings) computeStartwerte();
  }

  // ---------- Auto suggestions ----------
  function computeStepsIfWanted(){
    if(!state.selectedProblems || state.selectedProblems.length === 0){
      state.steps = [];
      stampLastRun();
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

  function renderProblems(){
    const container = $("problemGroups");
    if(!container) return;

    const groups = groupBy(AdvisorEngine.PROBLEMS, p=>p.group);
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

          computeStepsIfWanted();
          save();
          renderSteps();
          renderProblemsPill();
          setStatus("Problem(e) geändert → Lösung aktualisiert");
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
    const p = $("problemsPill");
    if(p) p.textContent = `${state.selectedProblems.length} gewählt`;
  }

  function renderCards(){
    const cardsEl = $("cards");
    if(!cardsEl) return;

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
    cardsEl.innerHTML = cards.join("");
  }

  function renderSteps(){
    const stepsEl = $("steps");
    const pill = $("stepPill");
    if(!stepsEl) return;

    const steps = state.steps || [];
    if(pill) pill.textContent = `${steps.length} Schritt(e)`;

    if(!steps.length){
      stepsEl.innerHTML = `<div class="hint">Wähle Probleme – dann erscheinen die Lösungen sofort.</div>`;
      return;
    }

    stepsEl.innerHTML = steps.map((st, idx)=>{
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

    stepsEl.querySelectorAll("button[data-apply]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.getAttribute("data-apply");
        applyStep(id);
      });
    });

    stepsEl.querySelectorAll("button[data-skip]").forEach(btn=>{
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

    // ✅ jede Änderung zählt
    learnUnrated(m, state.field.crop, state.settings);
    pushHistory("apply_step");

    // ✅ sofort neu
    computeStepsIfWanted();

    stampLastRun();
    save();
    renderAll();
    setStatus("Angewendet – Learning zählt (unbewertet)");
  }

  function renderTuning(){
    const tuning = $("tuning");
    if(!tuning) return;

    ensureSettings();
    const m = getMachine();
    const lim = m.limits;
    tuning.innerHTML = "";

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
      tuning.appendChild(makeTune(label, key, lim[key]));
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

    const setLabel = ()=> { if(tv) tv.textContent = `${round(state.settings[key], L.dp)} ${L.unit}`; };

    const setVal = (v)=>{
      const m = getMachine();
      state.ui.manualDirty = true;

      state.settings[key] = Number(v);
      state.settings = AdvisorEngine.sanitize(state.settings, m.limits);

      if(r) r.value = state.settings[key];
      if(n) n.value = state.settings[key];
      setLabel();

      learnUnrated(m, state.field.crop, state.settings);
      pushHistory("manual");

      computeStepsIfWanted();

      stampLastRun();
      save();
      renderCards();
      renderChecklist();
      renderSteps();
      setStatus("Manuell geändert → Learning zählt");
    };

    if(r) r.value = state.settings[key];
    if(n) n.value = state.settings[key];
    setLabel();

    r?.addEventListener("input", ()=>setVal(r.value));
    n?.addEventListener("change", ()=>setVal(n.value));

    return wrap;
  }

  function renderStability(){
    const pill = $("stabilityPill");
    if(!pill) return;
    const score = AdvisorEngine.stabilityScore(state.obs);
    let label = `Stabilität: ${score}/100`;
    if(score >= 78) label += " • gut";
    else if(score >= 55) label += " • mittel";
    else label += " • kritisch";
    pill.textContent = label;
  }

  function renderChecklist(){
    const list = $("checklist");
    if(!list) return;

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
    rows.push(checkRow(nAll>=5 ? "good":"warn","Learning",`Unbewertet: ${Math.floor(nAll)} • Bewertet (gewichtet): ${Math.floor(nRated)}`));

    rows.push(checkRow("good","Routine","Nach jeder Änderung 50–150 m prüfen: Kornprobe + Verluste."));

    list.innerHTML = rows.join("");
  }

  // ---------- Feedback / Problem-learning ----------
  function lKey(machineId, crop, pid){ return `${machineId}|${crop}|${pid}`; }
  function getLearningWeight(machineId, crop, pid){ return Number(state.learning[lKey(machineId,crop,pid)] ?? 0); }

  function feedback(delta){
    const m = getMachine();
    const crop = state.field.crop;

    const sel = state.selectedProblems || [];
    sel.forEach(pid=>{
      const k = lKey(m.id, crop, pid);
      state.learning[k] = clamp((Number(state.learning[k] ?? 0) + delta), -2, 2);
    });

    ensureSettings();
    learnRated(m, crop, state.settings, delta);
    pushHistory(delta === 1 ? "feedback_better" : delta === 0 ? "feedback_same" : "feedback_worse");

    computeStepsIfWanted();

    stampLastRun();
    save();
    renderChecklist();
    renderSteps();

    setStatus(delta>0 ? "Feedback: besser ✅" : delta<0 ? "Feedback: schlechter ⚠️" : "Feedback: gleich");
  }

  // ---------- Run snapshot / history ----------
  function stampLastRun(){
    const m = getMachineSafe();
    if(!m || !state.settings) return;
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
    if(!m || !state.settings) return;

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

    const MAX = 350;
    if(state.history.length > MAX){
      state.history = state.history.slice(state.history.length - MAX);
    }
  }

  // ---------- Export/Import ----------
  function openExport(){
    const dlg = $("dlgExport");
    const out = $("exportText");
    if(!dlg || !out) return;
    const payload = { app:"grainmaster", exportedAt: new Date().toISOString(), state };
    out.value = JSON.stringify(payload, null, 2);
    dlg.showModal();
  }

  function downloadExport(){
    const text = $("exportText")?.value || "";
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
    const dlg = $("dlgImport");
    const inp = $("importText");
    if(!dlg || !inp) return;
    inp.value = "";
    dlg.showModal();
  }

  function doImport(){
    const txt = ($("importText")?.value || "").trim();
    if(!txt) return;
    try{
      const payload = JSON.parse(txt);
      if(!payload?.state) throw new Error("no state");
      state = payload.state;

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

  // ---------- UI bits ----------
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
    if(!r || !l) return;
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
