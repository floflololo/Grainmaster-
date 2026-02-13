(function(){
  const $ = (id)=>document.getElementById(id);
  const STORAGE_KEY = "grainmaster_v1";

  const clone = (x)=>JSON.parse(JSON.stringify(x));
  const esc = (s)=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  const round = (v,p=0)=>{const m=10**p; return Math.round(v*m)/m;};

  // Sichtbare Fehler (damit nie wieder "passiert nichts")
  window.addEventListener("error", (e)=> alert("App-Fehler: " + (e.message || e.error || "Unbekannt")));
  window.addEventListener("unhandledrejection", (e)=> alert("Promise-Fehler: " + (e.reason?.message || e.reason || "Unbekannt")));

  const DEFAULT = {
    machine: { brand:null, modelId:null },
    field: { crop:"weizen", mode:"balanced", yieldT:8, moisture:14, straw:"normal", green:"low", headerWidth:12.2, notes:"" },
    obs: { rearLoss:2, sieveLoss:2, tailings:3, rotorLoad:4, cracks:1, dirty:2 },
    selectedProblems: [],
    settings: null,
    steps: [],
    learning: {}
  };

  let state = load() || clone(DEFAULT);
  let deferredPrompt = null;

  document.addEventListener("DOMContentLoaded", init);

  function init(){
    if(!window.MACHINE_DB) { alert("MACHINE_DB fehlt (machine-data.js)"); return; }
    if(!window.AdvisorEngine) { alert("AdvisorEngine fehlt (advisor-engine.js)"); return; }

    // PWA
    setupPWA();
    setupSW();

    // Header buttons
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

    // Scroll buttons
    $("btnScrollAdvisor").addEventListener("click", ()=> $("panelAdvisor").scrollIntoView({behavior:"smooth"}));
    $("btnScrollTop").addEventListener("click", ()=> window.scrollTo({top:0, behavior:"smooth"}));

    // Machine selects
    fillBrand();
    restoreMachine();
    $("brand").addEventListener("change", ()=>{
      fillModel();
      // set first model
      const list = window.MACHINE_DB[$("brand").value] || [];
      $("model").value = list[0]?.id || "";
      syncMachineFromUI();
      onMachineChanged();
    });
    $("model").addEventListener("change", ()=>{
      syncMachineFromUI();
      onMachineChanged();
    });

    // Field inputs
    ["crop","mode","yieldT","moisture","straw","green","headerWidth","notes"].forEach(id=>{
      $(id).addEventListener("change", ()=>{
        syncFieldFromUI();
        // Bei Kulturwechsel: Startwerte neu, Probleme/Steps reset
        if(id==="crop"){
          state.selectedProblems = [];
          state.steps = [];
          computeStartwerte();
        }
        save();
        renderAll();
        setStatus("Profil gespeichert");
      });
    });

    // Problems
    renderProblems(); // initial
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
      computeStartwerte();
      renderAll();
      setStatus("Startwerte berechnet");
      $("panelAdvisor").scrollIntoView({behavior:"smooth"});
    });

    $("btnVorschlaege").addEventListener("click", ()=>{
      ensureSettings();
      syncFieldFromUI();
      syncObsFromUI();
      const m = getMachine();
      state.steps = AdvisorEngine.buildSteps(
        m, state.field, state.settings, state.obs, state.selectedProblems,
        (pid)=>getLearningWeight(m.id, state.field.crop, pid)
      );
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
      });
    });

    // Feedback
    $("btnBetter").addEventListener("click", ()=>feedback(+1));
    $("btnSame").addEventListener("click", ()=>feedback(0));
    $("btnWorse").addEventListener("click", ()=>feedback(-1));

    // Hydrate UI
    hydrateFieldUI();
    hydrateObsUI();
    onMachineChanged(true);
  }

  function setStatus(t){ $("statusPill").textContent = t; }

  // -------- machine helpers --------
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

    // Bei Maschinenwechsel: Settings neu rechnen, Steps reset
    state.steps = [];
    state.selectedProblems = [];
    computeStartwerte();
    renderProblems();
    renderAll();
    setStatus(first ? "Bereit" : "Maschine angepasst");
  }

  // -------- field/obs --------
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

  // -------- compute/render --------
  function computeStartwerte(){
    syncFieldFromUI();
    const m = getMachine();
    state.settings = AdvisorEngine.computeStart(m, state.field);
    state.settings = AdvisorEngine.sanitize(state.settings, m.limits);
    save();
  }

  function ensureSettings(){
    if(!state.settings) computeStartwerte();
  }

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
    state.steps = [];
    save();
    renderProblemsPill();
    renderSteps();
    setStatus(`${state.selectedProblems.length} Problem(e)`);
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
      $("steps").innerHTML = `<div class="hint">Wähle Probleme oder nutze Sliderwerte, dann „Vorschläge“.</div>`;
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

    state.settings = AdvisorEngine.applyDelta(state.settings, step.delta);
    state.settings = AdvisorEngine.sanitize(state.settings, m.limits);
    state.steps = state.steps.filter(s=>s.id!==stepId);

    save();
    renderAll();
    setStatus("Angewendet – prüfen");
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
      state.settings[key] = Number(v);
      state.settings = AdvisorEngine.sanitize(state.settings, m.limits);
      r.value = state.settings[key];
      n.value = state.settings[key];
      setLabel();
      save();
      renderCards();
      renderChecklist();
    };

    r.value = state.settings[key];
    n.value = state.settings[key];
    setLabel();

    r.addEventListener("input", ()=>setVal(r.value));
    n.addEventListener("change", ()=>setVal(n.value));

    return wrap;
  }

  // Stability + Checklist
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

    rows.push(checkRow("good","Routine","Nach jeder Änderung 50–150 m prüfen: Kornprobe + Verluste."));

    $("checklist").innerHTML = rows.join("");
  }

  // Feedback learning
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
    save();
    setStatus(delta>0 ? "Feedback: besser ✅" : delta<0 ? "Feedback: schlechter ⚠️" : "Feedback: gleich");
  }

  // Export/Import
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
      save();
      location.reload();
    }catch{
      alert("Import fehlgeschlagen: ungültiger JSON.");
    }
  }

  // UI helpers
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

  // storage
  function load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return null;
      const s = JSON.parse(raw);
      // merge with DEFAULT
      const merged = clone(DEFAULT);
      Object.assign(merged, s);
      merged.machine = Object.assign(clone(DEFAULT.machine), s.machine||{});
      merged.field = Object.assign(clone(DEFAULT.field), s.field||{});
      merged.obs = Object.assign(clone(DEFAULT.obs), s.obs||{});
      merged.selectedProblems = Array.isArray(s.selectedProblems) ? s.selectedProblems : [];
      merged.steps = Array.isArray(s.steps) ? s.steps : [];
      merged.learning = (s.learning && typeof s.learning==="object") ? s.learning : {};
      return merged;
    }catch{
      return null;
    }
  }
  function save(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch{} }

  // PWA
  function setupPWA(){
    window.addEventListener("beforeinstallprompt",(e)=>{
      e.preventDefault();
      deferredPrompt = e;
      $("btnInstall").hidden = false;
    });
    $("btnInstall").addEventListener("click", async ()=>{
      if(!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      $("btnInstall").hidden = true;
    });
  }
  function setupSW(){
    if(!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }
})();
