(function(){
  const $ = (id)=>document.getElementById(id);
  const STORAGE_KEY = "grainmaster_v8";

  const clone = (x)=>JSON.parse(JSON.stringify(x));
  const esc = (s)=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  const round = (v,p=0)=>{const m=10**p; return Math.round(v*m)/m;};

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
    stats: {},
    history: [],
    ui: { autoRecalc:true, manualDirty:false }
  };

  let state = load() || clone(DEFAULT);
  let deferredPrompt = null;

  document.addEventListener("DOMContentLoaded", ()=>setTimeout(init, 0));

  function init(){
    if(!window.MACHINE_DB) { alert("MACHINE_DB fehlt (machine-data.js)"); return; }
    if(!window.AdvisorEngine) { alert("AdvisorEngine fehlt (advisor-engine.js)"); return; }

    injectMobileSafeUIStyles(); // ✅ macht active-chips + buttons sichtbar auf iPhone

    setupPWA();
    setupSW();

    click("btnReset", ()=>{
      if(!confirm("Wirklich Reset? Alles wird gelöscht.")) return;
      state = clone(DEFAULT);
      save();
      location.reload();
    });
    click("btnExport", openExport);
    click("btnImport", openImport);
    click("btnImportApply", (e)=>{ e?.preventDefault?.(); doImport(); $("dlgImport")?.close?.(); });
    click("btnCopy", (e)=>{ e?.preventDefault?.(); navigator.clipboard?.writeText($("exportText")?.value || ""); setStatus("Kopiert"); });
    click("btnDownload", (e)=>{ e?.preventDefault?.(); downloadExport(); });

    click("btnScrollAdvisor", ()=> $("panelAdvisor")?.scrollIntoView({behavior:"smooth"}));
    click("btnScrollTop", ()=> window.scrollTo({top:0, behavior:"smooth"}));

    const auto = $("autoRecalc");
    if(auto){
      auto.checked = !!state.ui.autoRecalc;
      auto.addEventListener("change", ()=>{
        state.ui.autoRecalc = !!auto.checked;
        save();
        setStatus(state.ui.autoRecalc ? "Auto-Startwerte: AN" : "Auto-Startwerte: AUS");
      });
    }

    click("btnResetManual", ()=>{
      state.ui.manualDirty = false;
      computeStartwerte();
      computeStepsIfWanted();
      renderAll();
      setStatus("Manuell zurückgesetzt");
    });

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

    ["crop","mode","yieldT","moisture","straw","green","headerWidth","notes"].forEach(id=>{
      $(id)?.addEventListener("change", ()=>{
        syncFieldFromUI();
        if(id==="crop"){ state.selectedProblems=[]; state.steps=[]; }
        if(state.ui.autoRecalc && !state.ui.manualDirty && id!=="notes"){ computeStartwerte(); }
        computeStepsIfWanted();
        save();
        renderAll();
      });
    });

    renderProblems();
    click("btnClearProblems", ()=>{
      state.selectedProblems = [];
      state.steps = [];
      save();
      renderProblems();      // ✅ Chips abwählen
      renderAll();
      setStatus("Probleme gelöscht");
    });

    click("btnStartwerte", ()=>{
      state.ui.manualDirty = false;
      computeStartwerte();
      computeStepsIfWanted();
      renderAll();
      setStatus("Startwerte berechnet");
    });

    // optionaler Button
    click("btnVorschlaege", ()=>{
      computeStepsForce();
      save();
      renderSteps();
      setStatus(`${state.steps.length} Vorschlag/Vorschläge`);
    });

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

    click("btnBetter", ()=>feedback(+1));
    click("btnSame", ()=>feedback(0));
    click("btnWorse", ()=>feedback(-1));

    hydrateFieldUI();
    hydrateObsUI();
    onMachineChanged(true);
  }

  function injectMobileSafeUIStyles(){
    // ✅ Fix für iPhone: Active-Chips sichtbar + Controls wrap + Buttons nie “weg”
    const css = `
      .chip{ -webkit-tap-highlight-color: transparent; }
      .chip.active{
        outline: 2px solid rgba(86, 194, 255, 0.95) !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 2px rgba(86,194,255,0.25) inset !important;
      }
      .chip:focus, .chip:focus-visible{
        outline: 2px solid rgba(86, 194, 255, 0.95) !important;
        outline-offset: 2px !important;
      }
      .step .controls{
        display:flex !important;
        gap:10px !important;
        flex-wrap: wrap !important;
        align-items:center !important;
      }
      .step .controls .btn{
        flex: 0 1 auto !important;
        min-width: 140px !important;
      }
    `;
    const tag = document.createElement("style");
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function click(id, fn){ $(id)?.addEventListener("click", fn); }
  function setStatus(t){ $("statusPill") && ($("statusPill").textContent = t); }

  // ---------- Machine ----------
  function brands(){ return Object.keys(window.MACHINE_DB).sort(); }
  function fillBrand(){
    const el=$("brand"); if(!el) return;
    el.innerHTML = brands().map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
  }
  function fillModel(){
    const el=$("model"); const b=$("brand"); if(!el||!b) return;
    const list = window.MACHINE_DB[b.value] || [];
    el.innerHTML = list.map(m=>`<option value="${esc(m.id)}">${esc(m.model)}</option>`).join("");
  }
  function restoreMachine(){
    const b=$("brand"), m=$("model"); if(!b||!m) return;
    const all=brands();
    b.value = (state.machine.brand && all.includes(state.machine.brand)) ? state.machine.brand : all[0];
    fillModel();
    const list = window.MACHINE_DB[b.value] || [];
    m.value = list.some(x=>x.id===state.machine.modelId) ? state.machine.modelId : (list[0]?.id || "");
    syncMachineFromUI();
    updateSummary();
  }
  function syncMachineFromUI(){
    state.machine.brand = $("brand")?.value || null;
    state.machine.modelId = $("model")?.value || null;
    updateSummary();
    save();
  }
  function getMachine(){
    const brand = state.machine.brand;
    const id = state.machine.modelId;
    const list = window.MACHINE_DB[brand] || [];
    const m = list.find(x=>x.id===id);
    if(!m) throw new Error("Maschinenprofil fehlt");
    return m;
  }
  function updateSummary(){
    const out=$("machineSummary"); if(!out) return;
    try{ out.value = getMachine().summary || ""; }catch{ out.value=""; }
  }
  function onMachineChanged(first=false){
    updateSummary();
    state.ui.manualDirty = false;
    state.steps = [];
    state.selectedProblems = [];
    computeStartwerte();
    renderProblems();
    computeStepsIfWanted();
    renderAll();
    setStatus(first ? "Bereit" : "Maschine angepasst");
  }

  // ---------- Field / Obs ----------
  function setVal(id,v){ const el=$(id); if(el) el.value=v; }
  function hydrateFieldUI(){
    setVal("crop", state.field.crop); setVal("mode", state.field.mode);
    setVal("yieldT", state.field.yieldT); setVal("moisture", state.field.moisture);
    setVal("straw", state.field.straw); setVal("green", state.field.green);
    setVal("headerWidth", state.field.headerWidth); setVal("notes", state.field.notes);
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
    setVal("rearLoss", state.obs.rearLoss); setVal("sieveLoss", state.obs.sieveLoss);
    setVal("tailings", state.obs.tailings); setVal("rotorLoad", state.obs.rotorLoad);
    setVal("cracks", state.obs.cracks); setVal("dirty", state.obs.dirty);
    ["rearLoss","sieveLoss","tailings","rotorLoad","cracks","dirty"].forEach(id=>{
      const lab=$(id+"Val"), r=$(id); if(lab&&r) lab.textContent=String(r.value);
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
  function statsKey(machineId,crop){ return `${machineId}|${crop}`; }
  function ensureStats(key){
    state.stats = (state.stats && typeof state.stats==="object") ? state.stats : {};
    if(!state.stats[key]){
      const sumAll={}, sumRated={};
      SET_KEYS.forEach(k=>{ sumAll[k]=0; sumRated[k]=0; });
      state.stats[key]={ nAll:0, sumAll, nRated:0, sumRated, lastTs:0 };
    }
    SET_KEYS.forEach(k=>{
      state.stats[key].sumAll[k] ??= 0;
      state.stats[key].sumRated[k] ??= 0;
    });
    return state.stats[key];
  }
  function pickSettings(s){ const out={}; SET_KEYS.forEach(k=> out[k]=Number(s?.[k] ?? 0)); return out; }
  function learnUnrated(m,crop,settings){
    const st=ensureStats(statsKey(m.id,crop));
    const x=pickSettings(settings);
    st.nAll += 1;
    SET_KEYS.forEach(k=> st.sumAll[k]+=x[k]);
    st.lastTs=Date.now();
  }
  function learnRated(m,crop,settings,rating){
    const st=ensureStats(statsKey(m.id,crop));
    const x=pickSettings(settings);
    const w = (rating===1)?2.0:(rating===0)?1.0:0.4;
    st.nRated += w;
    SET_KEYS.forEach(k=> st.sumRated[k]+=x[k]*w);
    st.lastTs=Date.now();
  }
  function mean(sum,n){ const o={}; SET_KEYS.forEach(k=> o[k]=sum[k]/n); return o; }
  function personalBaseline(m,crop){
    const st = state.stats?.[statsKey(m.id,crop)];
    if(!st) return null;
    const hasAll=st.nAll>=1, hasRated=st.nRated>=1;
    if(!hasAll && !hasRated) return null;
    const a = hasAll ? mean(st.sumAll, st.nAll) : null;
    const r = hasRated ? mean(st.sumRated, st.nRated) : null;
    let b = a || r;
    if(a && r){
      const alpha = clamp(0.35 + 0.10*Math.min(6, st.nRated), 0.35, 0.85);
      b = {}; SET_KEYS.forEach(k=> b[k]=a[k]*(1-alpha)+r[k]*alpha);
    }
    return AdvisorEngine.sanitize(b, m.limits);
  }

  // ---------- Startwerte ----------
  function computeStartwerte(){
    syncFieldFromUI();
    const m = getMachine();
    const base = AdvisorEngine.computeStart(m, state.field);
    const p = personalBaseline(m, state.field.crop);

    let final = base;
    if(p){
      const st = state.stats?.[statsKey(m.id, state.field.crop)];
      const n = st ? (st.nAll + st.nRated) : 0;
      const alpha = clamp(0.20 + 0.06*Math.min(20, n), 0.20, 0.70);
      final = { ...base };
      SET_KEYS.forEach(k=> final[k] = base[k]*(1-alpha) + p[k]*alpha);
    }
    state.settings = AdvisorEngine.sanitize(final, m.limits);
    save();
  }
  function ensureSettings(){ if(!state.settings) computeStartwerte(); }

  // ---------- Suggestions (sofort) ----------
  function computeStepsIfWanted(){
    if(!state.selectedProblems?.length){ state.steps=[]; return; }
    computeStepsForce();
  }
  function computeStepsForce(){
    ensureSettings(); syncFieldFromUI(); syncObsFromUI();
    const m=getMachine();
    state.steps = AdvisorEngine.buildSteps(
      m, state.field, state.settings, state.obs, state.selectedProblems,
      (pid)=> Number(state.learning[`${m.id}|${state.field.crop}|${pid}`] ?? 0)
    );
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
    const container=$("problemGroups"); if(!container) return;
    const groups = groupBy(AdvisorEngine.PROBLEMS, p=>p.group);
    container.innerHTML="";
    Object.entries(groups).forEach(([gname, items])=>{
      const g=document.createElement("div");
      g.className="group";
      g.innerHTML=`<div class="gt">${esc(gname)}</div>`;
      const chips=document.createElement("div");
      chips.className="chips";
      items.forEach(item=>{
        const btn=document.createElement("button");
        btn.type="button";
        btn.className="chip"+(state.selectedProblems.includes(item.id)?" active":"");
        btn.setAttribute("aria-pressed", state.selectedProblems.includes(item.id) ? "true" : "false");
        btn.title=item.hint;
        btn.textContent=item.title;

        btn.addEventListener("click", ()=>{
          const set=new Set(state.selectedProblems);
          const willActive = !set.has(item.id);
          willActive ? set.add(item.id) : set.delete(item.id);
          state.selectedProblems=[...set];

          // ✅ sofort optisch + state
          btn.classList.toggle("active", willActive);
          btn.setAttribute("aria-pressed", willActive ? "true" : "false");

          computeStepsIfWanted();
          save();
          renderProblemsPill();
          renderSteps();
          setStatus("Lösungen aktualisiert");
        });

        chips.appendChild(btn);
      });
      g.appendChild(chips);
      container.appendChild(g);
    });
    renderProblemsPill();
  }

  function renderProblemsPill(){
    const p=$("problemsPill");
    if(p) p.textContent=`${state.selectedProblems.length} gewählt`;
  }

  function renderCards(){
    const el=$("cards"); if(!el) return;
    ensureSettings();
    const m=getMachine(), s=state.settings;
    const tp=AdvisorEngine.estimateThroughput(state.field, s);

    el.innerHTML = [
      card("Rotor/Trommel", `${round(s.rotor,0)} ${m.limits.rotor.unit}`),
      card("Korb vorne", `${round(s.concaveFront,1)} ${m.limits.concaveFront.unit}`),
      card("Korb hinten", `${round(s.concaveRear,1)} ${m.limits.concaveRear.unit}`),
      card("Gebläse", `${round(s.fan,0)} ${m.limits.fan.unit}`),
      card("Obersieb", `${round(s.upperSieve,1)} ${m.limits.upperSieve.unit}`),
      card("Untersieb", `${round(s.lowerSieve,1)} ${m.limits.lowerSieve.unit}`),
      card("Geschwindigkeit", `${round(s.speed,1)} ${m.limits.speed.unit}`),
      card("Durchsatz", `${round(tp.tph,1)} t/h`)
    ].join("");
  }

  function renderSteps(){
    const el=$("steps"); if(!el) return;
    const pill=$("stepPill"); if(pill) pill.textContent=`${(state.steps||[]).length} Schritt(e)`;

    if(!state.steps?.length){
      el.innerHTML = `<div class="hint">Wähle Probleme – dann erscheinen die Lösungen sofort.</div>`;
      return;
    }

    el.innerHTML = state.steps.map((st, idx)=>`
      <div class="step">
        <div class="head">
          <div>
            <div class="title">Schritt ${idx+1}: ${esc(st.title)}</div>
            <div class="meta">${esc(st.meta)}</div>
          </div>
          <div class="tag ${esc(st.severity)}">${esc(st.severity==="bad"?"Kritisch":st.severity==="warn"?"Achtung":"OK")}</div>
        </div>
        <ul>${st.bullets.map(b=>`<li>${esc(b)}</li>`).join("")}</ul>
        <div class="controls">
          <button class="btn primary" data-apply="${st.id}">Anwenden</button>
          <button class="btn ghost" data-skip="${st.id}">Überspringen</button>
        </div>
      </div>
    `).join("");

    // Anwenden
    el.querySelectorAll("button[data-apply]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id=btn.getAttribute("data-apply");
        applyStep(id);
      });
    });

    // Überspringen
    el.querySelectorAll("button[data-skip]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id=btn.getAttribute("data-skip");
        state.steps = state.steps.filter(s=>s.id!==id);
        // Wenn nichts mehr übrig: Chips abwählen (wie du willst)
        if(state.steps.length === 0){
          state.selectedProblems = [];
          renderProblems(); // ✅ sofort optisch abwählen
        }
        save();
        renderSteps();
      });
    });
  }

  function applyStep(stepId){
    ensureSettings();
    const m=getMachine();
    const step = state.steps.find(s=>s.id===stepId);
    if(!step) return;

    state.ui.manualDirty = true;
    state.settings = AdvisorEngine.applyDelta(state.settings, step.delta);
    state.settings = AdvisorEngine.sanitize(state.settings, m.limits);

    // ✅ Learning zählt jede Änderung
    learnUnrated(m, state.field.crop, state.settings);

    // ✅ Schritt entfernen
    state.steps = state.steps.filter(s=>s.id!==stepId);

    // ✅ Wenn keine Schritte mehr da -> alles abwählen + Lösungen leer
    if(state.steps.length === 0){
      state.selectedProblems = [];
      renderProblems(); // wichtig: optisch am Handy abwählen
    }

    save();
    renderAll();
    setStatus("Angewendet");
  }

  function renderTuning(){
    const container=$("tuning"); if(!container) return;
    ensureSettings();
    const m=getMachine(), lim=m.limits;
    container.innerHTML="";
    const rows=[
      ["Rotor/Trommel","rotor"],
      ["Korb vorne","concaveFront"],
      ["Korb hinten","concaveRear"],
      ["Gebläse","fan"],
      ["Obersieb","upperSieve"],
      ["Untersieb","lowerSieve"],
      ["Geschwindigkeit","speed"]
    ];

    rows.forEach(([label,key])=>{
      const L=lim[key];
      const wrap=document.createElement("div");
      wrap.className="tune";
      wrap.innerHTML=`
        <div class="tune-top">
          <div class="tune-title">${esc(label)}</div>
          <div class="tune-val" id="tv_${esc(key)}"></div>
        </div>
        <div class="tune-row">
          <input id="tr_${esc(key)}" type="range" min="${L.min}" max="${L.max}" step="${L.step}">
          <input id="tn_${esc(key)}" type="number" min="${L.min}" max="${L.max}" step="${L.step}">
        </div>
      `;
      container.appendChild(wrap);

      const r=wrap.querySelector(`#tr_${key}`);
      const n=wrap.querySelector(`#tn_${key}`);
      const tv=wrap.querySelector(`#tv_${key}`);
      const setLabel=()=> tv.textContent = `${round(state.settings[key], L.dp)} ${L.unit}`;

      const setVal=(v)=>{
        state.ui.manualDirty=true;
        state.settings[key]=Number(v);
        state.settings=AdvisorEngine.sanitize(state.settings, m.limits);

        r.value=state.settings[key];
        n.value=state.settings[key];

        learnUnrated(m, state.field.crop, state.settings);

        computeStepsIfWanted();
        save();

        setLabel();
        renderCards();
        renderSteps();
        renderChecklist();
      };

      r.value=state.settings[key];
      n.value=state.settings[key];
      setLabel();

      r.addEventListener("input", ()=>setVal(r.value));
      n.addEventListener("change", ()=>setVal(n.value));
    });
  }

  function renderStability(){
    const pill=$("stabilityPill"); if(!pill) return;
    const score=AdvisorEngine.stabilityScore(state.obs);
    pill.textContent = `Stabilität: ${score}/100` + (score>=78?" • gut":score>=55?" • mittel":" • kritisch");
  }

  function renderChecklist(){
    const el=$("checklist"); if(!el) return;
    ensureSettings();
    const m=getMachine();
    const key=statsKey(m.id, state.field.crop);
    const st=state.stats?.[key];
    const nAll=Math.floor(st?.nAll||0), nRated=Math.floor(st?.nRated||0);

    el.innerHTML = `
      <div class="check"><div class="dot good"></div><div><div class="t">Learning</div><div class="d">Unbewertet: ${nAll} • Bewertet: ${nRated}</div></div></div>
      <div class="check"><div class="dot good"></div><div><div class="t">Routine</div><div class="d">Nach jeder Änderung 50–150 m prüfen (Kornprobe + Verluste).</div></div></div>
    `;
  }

  // Feedback
  function feedback(delta){
    const m=getMachine();
    (state.selectedProblems||[]).forEach(pid=>{
      const k=`${m.id}|${state.field.crop}|${pid}`;
      state.learning[k]=clamp((Number(state.learning[k]??0)+delta), -2, 2);
    });
    learnRated(m, state.field.crop, state.settings, delta);
    computeStepsIfWanted();
    save();
    renderChecklist();
    renderSteps();
    setStatus(delta>0?"Feedback: besser ✅":delta<0?"Feedback: schlechter ⚠️":"Feedback: gleich");
  }

  // helpers
  function card(k,v){ return `<div class="card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`; }
  function groupBy(arr, fn){ const out={}; arr.forEach(x=>{ const k=fn(x); (out[k]??=[]).push(x); }); return out; }
  function bindRange(rangeId, labelId){
    const r=$(rangeId), l=$(labelId);
    if(!r||!l) return;
    const upd=()=> l.textContent=String(r.value);
    r.addEventListener("input", upd);
    upd();
  }

  // Export/Import
  function openExport(){
    const dlg=$("dlgExport"), out=$("exportText");
    if(!dlg||!out) return;
    out.value = JSON.stringify({app:"grainmaster", exportedAt:new Date().toISOString(), state}, null, 2);
    dlg.showModal();
  }
  function downloadExport(){
    const text=$("exportText")?.value||"";
    const blob=new Blob([text],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=`grainmaster-export-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  function openImport(){
    const dlg=$("dlgImport"), inp=$("importText");
    if(!dlg||!inp) return;
    inp.value=""; dlg.showModal();
  }
  function doImport(){
    const txt=($("importText")?.value||"").trim(); if(!txt) return;
    try{
      const payload=JSON.parse(txt);
      if(!payload?.state) throw new Error("no state");
      state=payload.state;
      state.stats = (state.stats && typeof state.stats==="object") ? state.stats : {};
      state.history = Array.isArray(state.history) ? state.history : [];
      state.learning = (state.learning && typeof state.learning==="object") ? state.learning : {};
      state.ui ??= { autoRecalc:true, manualDirty:false };
      save(); location.reload();
    }catch{ alert("Import fehlgeschlagen: ungültiger JSON."); }
  }

  // Storage
  function load(){
    try{
      const raw=localStorage.getItem(STORAGE_KEY);
      if(!raw) return null;
      const s=JSON.parse(raw);
      const merged=clone(DEFAULT);
      Object.assign(merged, s);

      merged.machine = Object.assign(clone(DEFAULT.machine), s.machine||{});
      merged.field = Object.assign(clone(DEFAULT.field), s.field||{});
      merged.obs = Object.assign(clone(DEFAULT.obs), s.obs||{});
      merged.selectedProblems = Array.isArray(s.selectedProblems)?s.selectedProblems:[];
      merged.steps = Array.isArray(s.steps)?s.steps:[];
      merged.learning = (s.learning && typeof s.learning==="object")?s.learning:{};
      merged.stats = (s.stats && typeof s.stats==="object")?s.stats:{};
      merged.history = Array.isArray(s.history)?s.history:[];
      merged.ui = Object.assign(clone(DEFAULT.ui), s.ui||{});

      return merged;
    }catch{ return null; }
  }
  function save(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch{} }

  // PWA
  function setupPWA(){
    window.addEventListener("beforeinstallprompt",(e)=>{
      e.preventDefault();
      deferredPrompt = e;
      $("btnInstall") && ($("btnInstall").hidden = false);
    });
    $("btnInstall")?.addEventListener("click", async ()=>{
      if(!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      $("btnInstall").hidden = true;
    });
  }
  function setupSW(){
    if(!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./sw.js?v=8").catch(()=>{});
  }
})();
