/* app.js – Final Multi-Brand/Multi-Model Advisor
   - Seite 1: Marke/Modell
   - Seite 2: Advisor (Probleme -> Schritte -> manuell)
   - Speicherung: selected machine + last field + last settings + learning
*/

const $ = (id)=>document.getElementById(id);
const STORAGE_KEY = "combine_advisor_final_v1";

const DEFAULT_STATE = {
  machine: { brand: null, modelId: null },
  field: { crop:"weizen", mode:"balanced", yieldT:8, moisture:14, straw:"normal", green:"low", headerWidth:12.2, notes:"" },
  obs: { rearLoss:2, sieveLoss:2, tailings:3, rotorLoad:4, cracks:1, dirty:2 },
  selectedProblems: [],
  settings: null, // computed after machine chosen
  steps: [],
  learning: {} // key: `${machineId}|${crop}|${problemId}` -> -2..2
};

let state = loadState() ?? structuredClone(DEFAULT_STATE);

let deferredPrompt = null;

boot();

function boot(){
  // Select page
  fillBrandSelect();
  $("brand").addEventListener("change", ()=>{ fillModelSelect(); saveSoon("Marke gespeichert"); });
  $("model").addEventListener("change", ()=>{ updateMachineSummary(); saveSoon("Modell gespeichert"); });

  $("btnGoAdvisor").addEventListener("click", ()=>{
    syncMachineFromUI();
    if(!state.machine.brand || !state.machine.modelId){
      setStatus("Bitte Marke & Modell wählen");
      return;
    }
    ensureSettings();
    showAdvisor();
    setStatus("Advisor bereit");
  });

  $("btnEditModelJson").addEventListener("click", ()=>{
    const dump = JSON.stringify(window.MACHINE_DB, null, 2);
    $("modelsDump").value = dump;
    $("dlgModels").showModal();
  });

  // Advisor page actions
  $("btnBack").addEventListener("click", ()=>{ showSelect(); setStatus("Maschine wählen"); });

  $("btnCompute").addEventListener("click", ()=>{
    syncAdvisorFromUI();
    state.settings = AdvisorEngine.computeStart(getMachineProfile(), state.field);
    state.steps = [];
    saveSoon("Startwerte gespeichert");
    renderAdvisorAll();
    setStatus("Startwerte berechnet");
  });

  $("btnSuggest").addEventListener("click", ()=>{
    syncAdvisorFromUI();
    const mp = getMachineProfile();
    const steps = AdvisorEngine.buildSteps(
      mp,
      state.field,
      state.settings,
      state.selectedProblems,
      (pid)=> getLearningWeight(mp.id, state.field.crop, pid)
    );
    state.steps = steps;
    saveSoon("Vorschläge gespeichert");
    renderAdvisorAll();
    setStatus(`${steps.length} Schritt(e) erzeugt`);
  });

  $("btnClearProblems").addEventListener("click", ()=>{
    state.selectedProblems = [];
    state.steps = [];
    saveSoon("Probleme gelöscht");
    renderProblems();
    renderSteps();
    setStatus("Probleme gelöscht");
  });

  // Feedback learning
  $("btnBetter").addEventListener("click", ()=>feedback(+1));
  $("btnSame").addEventListener("click", ()=>feedback(0));
  $("btnWorse").addEventListener("click", ()=>feedback(-1));

  // Export/Import/Reset
  $("btnExport").addEventListener("click", openExport);
  $("btnImport").addEventListener("click", openImport);
  $("btnReset").addEventListener("click", ()=>{
    if(!confirm("Wirklich Reset? Alle Daten werden gelöscht.")) return;
    state = structuredClone(DEFAULT_STATE);
    saveState();
    location.reload();
  });

  $("btnImportApply").addEventListener("click", (e)=>{ e.preventDefault(); doImport(); $("dlgImport").close(); });
  $("btnCopy").addEventListener("click", (e)=>{ e.preventDefault(); navigator.clipboard?.writeText($("exportText").value); setStatus("Kopiert"); });
  $("btnDownload").addEventListener("click", (e)=>{ e.preventDefault(); downloadExport(); });

  setupPWA();
  setupServiceWorker();

  // Start view decision
  if(state.machine.brand && state.machine.modelId){
    // prefill selects
    $("brand").value = state.machine.brand;
    fillModelSelect();
    $("model").value = state.machine.modelId;
    updateMachineSummary();
    ensureSettings();
    showAdvisor();
    renderAdvisorAll();
    setStatus("Advisor bereit");
  } else {
    showSelect();
    setStatus("Maschine wählen");
  }
}

function setStatus(t){ $("statusPill").textContent = t; }

let saveTimer=null;
function saveSoon(label){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
    saveState();
    if(label) setStatus(label);
  }, 180);
}

// ---------- Views ----------
function showSelect(){
  $("view-select").classList.remove("hidden");
  $("view-advisor").classList.add("hidden");
}

function showAdvisor(){
  $("view-select").classList.add("hidden");
  $("view-advisor").classList.remove("hidden");
  renderMachineTitle();
  applyFieldToUI();
  renderProblems();
  renderAdvisorAll();
}

// ---------- Machine selection ----------
function fillBrandSelect(){
  const brands = Object.keys(window.MACHINE_DB).sort();
  $("brand").innerHTML = brands.map(b=>`<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("");
  if(state.machine.brand && brands.includes(state.machine.brand)){
    $("brand").value = state.machine.brand;
  }
  fillModelSelect();
}

function fillModelSelect(){
  const brand = $("brand").value;
  const list = window.MACHINE_DB[brand] || [];
  $("model").innerHTML = list.map(m=>`<option value="${escapeHtml(m.id)}">${escapeHtml(m.model)}</option>`).join("");
  // restore previous
  if(state.machine.brand===brand && state.machine.modelId){
    const exists = list.some(m=>m.id===state.machine.modelId);
    if(exists) $("model").value = state.machine.modelId;
  }
  updateMachineSummary();
}

function updateMachineSummary(){
  const mp = getSelectedMachineFromUI();
  $("machineSummary").value = mp ? mp.summary : "";
  syncMachineFromUI();
}

function getSelectedMachineFromUI(){
  const brand = $("brand").value;
  const id = $("model").value;
  const list = window.MACHINE_DB[brand] || [];
  return list.find(m=>m.id===id) || null;
}

function syncMachineFromUI(){
  state.machine.brand = $("brand").value || null;
  state.machine.modelId = $("model").value || null;
}

function getMachineProfile(){
  const brand = state.machine.brand;
  const id = state.machine.modelId;
  const list = window.MACHINE_DB[brand] || [];
  const mp = list.find(m=>m.id===id);
  if(!mp) throw new Error("Machine profile not found");
  return mp;
}

function renderMachineTitle(){
  const mp = getMachineProfile();
  $("machineTitle").textContent = `${mp.brand} ${mp.model}`;
}

// ---------- Advisor UI ----------
function ensureSettings(){
  const mp = getMachineProfile();
  if(!state.settings){
    state.settings = AdvisorEngine.computeStart(mp, state.field);
  }
  // sanitize against model limits always
  state.settings = AdvisorEngine.sanitize(state.settings, mp.limits);
  saveSoon();
}

function applyFieldToUI(){
  $("crop").value = state.field.crop;
  $("mode").value = state.field.mode;
  $("yieldT").value = state.field.yieldT;
  $("moisture").value = state.field.moisture;
  $("straw").value = state.field.straw;
  $("green").value = state.field.green;
  $("headerWidth").value = state.field.headerWidth;
  $("notes").value = state.field.notes;

  // Changes autosave
  ["crop","mode","yieldT","moisture","straw","green","headerWidth","notes"].forEach(id=>{
    $(id).addEventListener("change", ()=>{
      syncAdvisorFromUI();
      // recompute start on crop change
      if(id==="crop"){
        state.settings = AdvisorEngine.computeStart(getMachineProfile(), state.field);
        state.steps = [];
        state.selectedProblems = [];
      }
      state.settings = AdvisorEngine.sanitize(state.settings, getMachineProfile().limits);
      saveSoon("Profil gespeichert");
      renderProblems();
      renderAdvisorAll();
    });
  });
}

function syncAdvisorFromUI(){
  state.field.crop = $("crop").value;
  state.field.mode = $("mode").value;
  state.field.yieldT = Number($("yieldT").value);
  state.field.moisture = Number($("moisture").value);
  state.field.straw = $("straw").value;
  state.field.green = $("green").value;
  state.field.headerWidth = Number($("headerWidth").value);
  state.field.notes = $("notes").value || "";
}

function renderAdvisorAll(){
  renderCards();
  renderSteps();
  renderTuning();
  renderConfidence();
  renderChecklist();
}

function renderProblems(){
  const groups = groupBy(AdvisorEngine.PROBLEMS, p=>p.group);
  const container = $("problemGroups");
  container.innerHTML = "";

  for(const [gname, items] of Object.entries(groups)){
    const g = document.createElement("div");
    g.className = "group";
    g.innerHTML = `<div class="gt">${escapeHtml(gname)}</div>`;
    const chips = document.createElement("div");
    chips.className = "chips";

    for(const item of items){
      const c = document.createElement("button");
      c.type="button";
      c.className = "chip" + (state.selectedProblems.includes(item.id) ? " active" : "");
      c.title = item.hint;
      c.textContent = item.title;
      c.addEventListener("click", ()=>{
        toggleProblem(item.id);
        c.classList.toggle("active");
      });
      chips.appendChild(c);
    }
    g.appendChild(chips);
    container.appendChild(g);
  }
}

function toggleProblem(id){
  const set = new Set(state.selectedProblems);
  if(set.has(id)) set.delete(id); else set.add(id);
  state.selectedProblems = Array.from(set);
  state.steps = [];
  saveSoon("Probleme gespeichert");
}

function renderCards(){
  const mp = getMachineProfile();
  const s = state.settings;
  const tp = AdvisorEngine.estimateThroughput(state.field, s);

  const cards = [
    card("Rotor/Trommel", s.rotor, mp.limits.rotor.unit, tagRotor(s.rotor, mp)),
    card("Korb vorne", round(s.concaveFront,1), mp.limits.concaveFront.unit, tagConc(s.concaveFront)),
    card("Korb hinten", round(s.concaveRear,1), mp.limits.concaveRear.unit, tagConc(s.concaveRear)),
    card("Gebläse", s.fan, mp.limits.fan.unit, tagFan(s.fan)),
    card("Obersieb", round(s.upperSieve,1), mp.limits.upperSieve.unit, tagSieve(s.upperSieve)),
    card("Untersieb", round(s.lowerSieve,1), mp.limits.lowerSieve.unit, tagSieveLow(s.lowerSieve, s.upperSieve)),
    card("Speed", round(s.speed,1), mp.limits.speed.unit, tagSpeed(s.speed)),
    card("Durchsatz", round(tp.tph,1), "t/h", { text:"Orientierung", level:"good" })
  ];
  $("cards").innerHTML = cards.join("");
}

function renderSteps(){
  const steps = state.steps || [];
  $("stepPill").textContent = `${steps.length} Schritt(e)`;

  if(!steps.length){
    $("steps").innerHTML = `<div class="hint">Wähle Probleme und klicke „Vorschläge“.</div>`;
    return;
  }

  $("steps").innerHTML = steps.map((st, idx)=>{
    const changes = Object.entries(st.delta)
      .map(([k,d])=>`${k}: ${d>0?"+":""}${formatDelta(k,d)}`)
      .join(" • ");
    return `
      <div class="step">
        <div class="head">
          <div>
            <div class="title">Schritt ${idx+1}: ${escapeHtml(st.title)}</div>
            <div class="meta">${escapeHtml(st.meta)}</div>
            <div class="kv">${escapeHtml(changes)}</div>
          </div>
          <div class="tag ${st.severity}">${sevLabel(st.severity)}</div>
        </div>
        <ul>${st.bullets.map(b=>`<li>${escapeHtml(b)}</li>`).join("")}</ul>
        <div class="controls">
          <button class="btn primary" data-apply="${st.id}">Empfehlung anwenden</button>
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
      state.steps = (state.steps||[]).filter(s=>s.id!==id);
      saveSoon("Schritt entfernt");
      renderSteps();
    });
  });
}

function applyStep(stepId){
  const mp = getMachineProfile();
  const step = (state.steps||[]).find(s=>s.id===stepId);
  if(!step) return;

  state.settings = AdvisorEngine.applyDelta(state.settings, step.delta);
  state.settings = AdvisorEngine.sanitize(state.settings, mp.limits);
  state.steps = (state.steps||[]).filter(s=>s.id!==stepId);

  saveSoon("Angewendet – jetzt prüfen");
  renderAdvisorAll();
}

function renderTuning(){
  const mp = getMachineProfile();
  const limits = mp.limits;

  const container = $("tuning");
  container.innerHTML = "";

  const keys = [
    ["Rotor/Trommel", "rotor"],
    ["Korb vorne", "concaveFront"],
    ["Korb hinten", "concaveRear"],
    ["Gebläse", "fan"],
    ["Obersieb", "upperSieve"],
    ["Untersieb", "lowerSieve"],
    ["Fahrgeschwindigkeit", "speed"]
  ];

  for(const [label, key] of keys){
    container.appendChild(makeTune(label, key, limits[key]));
  }
}

function makeTune(label, key, lim){
  const wrap = document.createElement("div");
  wrap.className = "tune";

  const top = document.createElement("div");
  top.className = "tune-top";
  top.innerHTML = `<div class="tune-title">${escapeHtml(label)}</div><div class="tune-val" id="tv_${key}"></div>`;

  const row = document.createElement("div");
  row.className = "tune-row";

  const range = document.createElement("input");
  range.type="range";
  range.min=lim.min; range.max=lim.max; range.step=lim.step;
  range.value=state.settings[key];

  const num = document.createElement("input");
  num.type="number";
  num.min=lim.min; num.max=lim.max; num.step=lim.step;
  num.value=state.settings[key];

  const setVal = (v)=>{
    state.settings[key] = Number(v);
    state.settings = AdvisorEngine.sanitize(state.settings, getMachineProfile().limits);
    range.value = state.settings[key];
    num.value = state.settings[key];
    updateTuneLabel(key, lim);
    saveSoon("Einstellung gespeichert");
    renderCards();
    renderChecklist();
  };

  range.addEventListener("input", ()=>setVal(range.value));
  num.addEventListener("change", ()=>setVal(num.value));

  row.appendChild(range);
  row.appendChild(num);
  wrap.appendChild(top);
  wrap.appendChild(row);

  setTimeout(()=>updateTuneLabel(key, lim), 0);
  return wrap;
}

function updateTuneLabel(key, lim){
  const el = document.getElementById(`tv_${key}`);
  if(!el) return;
  el.textContent = `${round(state.settings[key], lim.dp)} ${lim.unit}`;
}

function renderConfidence(){
  const score = AdvisorEngine.stabilityScore(state.obs);
  let label = `Stabilität: ${score}/100`;
  if(score >= 78) label += " • gut";
  else if(score >= 55) label += " • mittel";
  else label += " • kritisch";
  $("confidencePill").textContent = label;
}

function renderChecklist(){
  // Minimal-Checkliste (du kannst beliebig erweitern)
  const mp = getMachineProfile();
  const s = state.settings;

  const checks = [];
  checks.push(checkRow("good", "Maschine", `${mp.brand} ${mp.model}`));
  checks.push(checkRow("good", "System", `${mp.architecture.threshSystem}`));
  checks.push(checkRow(s.lowerSieve > s.upperSieve ? "bad" : "good", "Plausibilität", s.lowerSieve > s.upperSieve ? "Untersieb > Obersieb – Untersieb kleiner stellen." : "Siebe plausibel."));
  checks.push(checkRow("good", "Routine", "Nach jeder Änderung 50–150 m prüfen: Kornprobe + Verluste."));

  $("checklist").innerHTML = checks.join("");
}

function checkRow(stateColor, title, desc){
  return `
    <div class="check">
      <div class="dot ${stateColor}"></div>
      <div>
        <div class="t">${escapeHtml(title)}</div>
        <div class="d">${escapeHtml(desc)}</div>
      </div>
    </div>
  `;
}

// ---------- learning ----------
function learningKey(machineId, crop, pid){
  return `${machineId}|${crop}|${pid}`;
}
function getLearningWeight(machineId, crop, pid){
  const k = learningKey(machineId, crop, pid);
  return Number(state.learning[k] ?? 0);
}
function feedback(delta){
  const mp = getMachineProfile();
  const crop = state.field.crop;
  const selected = state.selectedProblems || [];
  for(const pid of selected){
    const k = learningKey(mp.id, crop, pid);
    const v = clamp((Number(state.learning[k] ?? 0) + delta), -2, 2);
    state.learning[k] = v;
  }
  saveSoon(delta>0 ? "Feedback: besser ✅" : delta<0 ? "Feedback: schlechter⚠️" : "Feedback: gleich");
}

// ---------- Export/Import ----------
function openExport(){
  const payload = { app:"combine-advisor", exportedAt: new Date().toISOString(), state };
  $("exportText").value = JSON.stringify(payload, null, 2);
  $("dlgExport").showModal();
}
function downloadExport(){
  const text = $("exportText").value || "";
  const blob = new Blob([text], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `combine-advisor-export-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus("Export gespeichert");
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
    saveState();
    location.reload();
  }catch{
    alert("Import fehlgeschlagen: ungültiger JSON.");
  }
}

// ---------- PWA ----------
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
    setStatus("Installationsdialog geöffnet");
  });
}
function setupServiceWorker(){
  if(!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}

// ---------- Storage ----------
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    const s = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_STATE), ...s };
  }catch{
    return null;
  }
}
function saveState(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch{}
}

// ---------- UI helper ----------
function escapeHtml(str){
  return String(str).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function structuredClone(obj){ return JSON.parse(JSON.stringify(obj)); }
function groupBy(arr, fn){
  const out = {};
  for(const x of arr){
    const k = fn(x);
    out[k] ??= [];
    out[k].push(x);
  }
  return out;
}
function round(v,p=0){ const m=10**p; return Math.round(v*m)/m; }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

function sevLabel(s){ return s==="bad"?"Kritisch":s==="warn"?"Achtung":"OK"; }
function formatDelta(key, d){
  // quick formatting
  const dp = Number.isInteger(d) ? 0 : 1;
  return `${round(d, dp)}`;
}

// Simple tags (keine Marketing-Magie, nur Hinweise)
function tagRotor(v, mp){
  const t = mp.architecture.type;
  if(t==="walker"){
    if(v>860) return {text:"Aggressiv", level:"warn"};
    if(v<650) return {text:"Schonend", level:"good"};
    return {text:"Normal", level:"good"};
  }
  if(v>980) return {text:"Aggressiv", level:"warn"};
  if(v<680) return {text:"Schonend", level:"good"};
  return {text:"Normal", level:"good"};
}
function tagConc(v){ if(v<=8) return {text:"Eng",level:"warn"}; if(v>=24) return {text:"Offen",level:"good"}; return {text:"Normal",level:"good"}; }
function tagFan(v){ if(v>=1120) return {text:"Viel Luft",level:"warn"}; if(v<=740) return {text:"Unsauber?",level:"warn"}; return {text:"Stabil",level:"good"}; }
function tagSieve(v){ if(v<=9) return {text:"Sauber",level:"good"}; if(v>=20) return {text:"Durchsatz",level:"warn"}; return {text:"Normal",level:"good"}; }
function tagSieveLow(v, upper){ if(v>=upper) return {text:"Zu groß",level:"bad"}; if(v<=5) return {text:"Sauber",level:"good"}; if(v>=16) return {text:"Rücklauf?",level:"warn"}; return {text:"Normal",level:"good"}; }
function tagSpeed(v){ if(v>=7.5) return {text:"Schnell",level:"warn"}; if(v<=4.5) return {text:"Schonend",level:"good"}; return {text:"Normal",level:"good"}; }

function card(k,v,u,tag){
  const level = tag?.level ?? "";
  const t = tag?.text ?? "Advisor";
  return `
    <div class="card">
      <div class="k">${escapeHtml(k)}</div>
      <div class="v">${escapeHtml(v)}</div>
      <div class="u">${escapeHtml(u)}</div>
      <div class="tag ${level}">${escapeHtml(t)}</div>
    </div>
  `;
}

