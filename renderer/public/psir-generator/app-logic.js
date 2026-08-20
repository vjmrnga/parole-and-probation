
/* ================= APP LOGIC ================= */
const $ = id => document.getElementById(id);
const val = id => ($(id) ? $(id).value.trim() : "");

/* ---- default data ---- */
const AGENCIES = [
  ["NBI","No Derogatory Record"],
  ["CMRD/CMRU","No Probation Record"],
  ["Prosecutor","No Record on File"],
  ["RTC-OCC","No Criminal Case Filed"],
  ["MTCC-OCC","No Criminal Case Filed"],
  ["Police","No Record on File"],
  ["Barangay","No Record on File"],
];

const RATE_GROUPS = [
  {id:"econ", title:"A. Family Economic Status", def:"Low-income class (but not poor)",
   opts:["Poor","Low-income class (but not poor)","Lower middle-income class","Middle middle-income class","Upper middle-income class","Upper-income class (but not rich)","Rich"]},
  {id:"famrel", title:"B. Family Relationship", def:"Very satisfactory", opts:["Very satisfactory","Satisfactory","Poor"]},
  {id:"famrep", title:"C. Family Reputation", def:"Very satisfactory", opts:["Very satisfactory","Satisfactory","Poor"]},
  {id:"wellbeing", title:"D. Overall Well-Being", def:"Very satisfactory", opts:["Very satisfactory","Satisfactory","Poor"]},
  {id:"famsup", title:"E. Family Support", def:"Very satisfactory", opts:["Very satisfactory","Satisfactory","Poor"]},
  {id:"commsup", title:"F. Community Support", def:"Very satisfactory", opts:["Very satisfactory","Satisfactory","Poor"]},
];

/* exact texts as they appear in the original document */
const THRUSTS = [
  "Monthly/periodic report-in-person;",
  "Monitoring and supervision;",
  "Restorative Justice Processes",
  "Individual/Group/Family/ Marital Coaching",
  "Community Work Service/Involvement in Community/Barangay integration activities but not limited to tree/growing and cleanliness drive",
  "Spiritual/Moral Formation/ Reformation Activities",
  "Sports and Wellness activities",
  "Periodic Random Drug Test",
  "Home/Work Visits",
  "Payment of Civil Liabilities, if applicable",
];

/* Condition texts mirroring the document exactly; d = pronouns + editable parts */
const CONDITIONS = [
  d => `${d.Pos} probation period shall be for ${d.period} to be counted from ${d.pos} initial reporting for supervision;`,
  d => `${d.Subj} shall initially report to the Chief Probation and Parole Officer of ${d.officeT} located at the ${d.officeAddr} within seventy-two (72) hours from the receipt of the Order granting probation;`,
  d => `${d.Subj} shall, thereafter, report to ${d.pos} Supervising Officer at least once a month unless otherwise modified by the Chief Probation and Parole Officer;`,
  d => `${d.Subj} shall reside at ${d.residence} and shall not change ${d.pos} residence without prior approval of the Chief Probation and Parole Officer, or the Court, as the case may be;`,
  d => `${d.Subj} shall secure a written permit to travel outside the jurisdiction of ${d.officeT} from the Chief Probation and Parole Officer, or from the Court, if such travel exceeds thirty (30) days;`,
  d => `${d.Subj} shall not commit any crime or any other offense;`,
  d => `${d.Subj} shall render Community Work Service (CWS);`,
  d => `${d.Subj} shall allow the Supervising Probation and Parole Officer or an authorized Volunteer Probation Assistant (VPA) to visit ${d.pos} home and place of work;`,
  d => `${d.Subj} shall meet ${d.pos} family responsibilities;`,
  d => `${d.Subj} shall undergo medical, psychological or psychiatric examination and treatment and enter and remain in a specified institution, when required for that purpose;`,
  d => `${d.Subj} shall devote ${d.self} to a specific employment and shall not change said employment without prior notice to the Supervising Officer and/or pursue a prescribed secular study or vocational training;`,
  d => `${d.Subj} shall refrain from associating with persons of questionable character;`,
  d => `${d.Subj} shall cooperate with ${d.pos} program of supervision, and shall satisfy any other conditions related to ${d.pos} rehabilitation and not unduly restrictive of ${d.pos} liberty nor incompatible with ${d.pos} freedom of conscience; and`,
  d => `${d.Subj} shall undergo mandatory drug tests.`,
];

/* Sec. 9, P.D. 968 as amended by R.A. 10707 — disqualification grounds */
const DQ_GROUNDS = [
  ["a","sentenced to serve a maximum term of imprisonment of more than six (6) years;"],
  ["b","convicted of any crime against the national security;"],
  ["c","who have previously been convicted by final judgment of an offense punished by imprisonment of more than six (6) months and one (1) day and/or a fine of more than one thousand pesos (P1,000.00);"],
  ["d","who have been once on probation under the provisions of this Decree;"],
  ["e","who are already serving sentence at the time the substantive provisions of this Decree became applicable pursuant to Section 33 hereof."],
];
function selectedGrounds(){
  return DQ_GROUNDS.filter((g,i)=>$("dq_"+i) && $("dq_"+i).checked);
}
function groundLetters(){
  const L = selectedGrounds().map(g=>g[0]);
  if(!L.length) return "___";
  if(L.length===1) return L[0];
  return L.slice(0,-1).join(", ") + " and " + L[L.length-1];
}
function buildDqList(){
  const w = $("dqList");
  if(!w) return;
  w.innerHTML = "";
  DQ_GROUNDS.forEach((g,i)=>{
    const l = document.createElement("label");
    l.className = "choice" + (g[0]==="c" ? " checked" : "");
    l.innerHTML = `<input type="checkbox" id="dq_${i}" ${g[0]==="c"?"checked":""}> <span><b>${g[0]}.</b> ${g[1]}</span>`;
    w.appendChild(l);
  });
}
function updateVerdictUI(){
  const v = val("recoVerdict");
  if($("dqPanel")) $("dqPanel").style.display = v==="LEGAL_DQ" ? "" : "none";
  if($("condWrap")) $("condWrap").classList.toggle("blocked", v!=="GRANTED");
  if($("thrustWrap")) $("thrustWrap").classList.toggle("blocked", v!=="GRANTED");
  if($("thrustNote")) $("thrustNote").style.display = v==="GRANTED" ? "none" : "";
  document.querySelectorAll(".grant-only").forEach(el=>el.classList.toggle("blocked", v!=="GRANTED"));
}

/* ---- sentence builder (min Y-M-D [to max Y-M-D] + fine) ---- */
let SENTENCES = [{y:"",m:"",d:"",y2:"",m2:"",d2:"",fine:""}];
function renderSentences(){
  const w = $("sentList");
  if(!w) return;
  w.innerHTML = "";
  SENTENCES.forEach((sn,i)=>{
    const d = document.createElement("div");
    d.className = "brow";
    d.innerHTML = `<span class="tag">#${i+1}</span>
      <label class="mini">Min Yrs<input type="number" min="0" id="sn_y_${i}" value="${sn.y}" placeholder="0"></label>
      <label class="mini">Min Mos<input type="number" min="0" id="sn_m_${i}" value="${sn.m}" placeholder="0"></label>
      <label class="mini">Min Days<input type="number" min="0" id="sn_d_${i}" value="${sn.d}" placeholder="30"></label>
      <span class="sep">to</span>
      <label class="mini">Max Yrs<input type="number" min="0" id="sn_y2_${i}" value="${sn.y2}" placeholder="—"></label>
      <label class="mini">Max Mos<input type="number" min="0" id="sn_m2_${i}" value="${sn.m2}" placeholder="—"></label>
      <label class="mini">Max Days<input type="number" min="0" id="sn_d2_${i}" value="${sn.d2}" placeholder="—"></label>
      <label class="mini wide">Fine (₱)<input type="number" min="0" step="0.01" id="sn_f_${i}" value="${sn.fine}" placeholder="10,000.00"></label>
      ${SENTENCES.length>1?`<button type="button" class="xbtn" title="Remove">✕</button>`:""}`;
    w.appendChild(d);
    [["y","y"],["m","m"],["d","d"],["y2","y2"],["m2","m2"],["d2","d2"],["f","fine"]].forEach(([k,prop])=>{
      $(`sn_${k}_${i}`).addEventListener("input", e=>{
        SENTENCES[i][prop] = e.target.value;
        updateSentPreview();
      });
    });
    const rmBtn = d.querySelector(".xbtn");
    if(rmBtn) rmBtn.addEventListener("click", ()=>removeSentence(i));
  });
  updateSentPreview();
}
function addSentence(){ SENTENCES.push({y:"",m:"",d:"",y2:"",m2:"",d2:"",fine:""}); renderSentences(); }
function removeSentence(i){ SENTENCES.splice(i,1); renderSentences(); }
function fmtPeso(v){
  const n = parseFloat(v);
  if(isNaN(n)) return "";
  return "₱" + n.toLocaleString("en-PH",{minimumFractionDigits:2, maximumFractionDigits:2});
}
function composeSentence(){
  const has = v => v !== "" && v !== null && v !== undefined && !isNaN(parseFloat(v));
  const n = v => has(v) ? String(parseInt(v,10)) : "0";
  const parts = [];
  SENTENCES.forEach(sn=>{
    const bits = [];
    if(has(sn.y)||has(sn.m)||has(sn.d)){
      let t = `Imprisonment of ${n(sn.y)}-${n(sn.m)}-${n(sn.d)}`;
      if(has(sn.y2)||has(sn.m2)||has(sn.d2)) t += ` to ${n(sn.y2)}-${n(sn.m2)}-${n(sn.d2)}`;
      bits.push(t);
    }
    if(has(sn.fine) && parseFloat(sn.fine)>0) bits.push(`a fine of ${fmtPeso(sn.fine)}`);
    if(bits.length){ const s = bits.join(" and "); parts.push(s.charAt(0).toUpperCase() + s.slice(1)); }
  });
  if(!parts.length) return "";
  if(parts.length===1) return parts[0];
  const items = parts.map((p,i)=>`(${i+1}) ${p}`);
  return items.slice(0,-1).join("; ") + "; and " + items[items.length-1];
}
function updateSentPreview(){
  const el = $("sentPreview");
  if(el) el.textContent = "Will print as: " + (composeSentence() || "(blank)");
}

/* ---- offense builders (free-text citation, e.g. "Sec. 5, Art. II of R.A. 9165") ---- */
const OFFENSES = {
  charged:   [{text:"",date:""}],
  convicted: [{text:"",date:""}],
};
function escAttr(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
// Old rows were split into Sec./Art./Law/Number fields; a row saved under
// that shape (no `text`, but a `sec`/`no`) is composed into the same string
// those fields used to print, so previously-saved profiles still show and
// print correctly under the free-text field — mirrors offenseRowToText() in
// renderer/src/utils/caseProfileDefaults.js.
function migrateOffenseRow(o){
  if(!o) return {text:"",date:""};
  if(typeof o.text === "string" && o.text.trim()) return {text:o.text, date:o.date||""};
  if(o.sec || o.no){
    let t = o.sec && o.sec.trim() ? `Sec. ${o.sec.trim()}` : "";
    if(o.art && o.art.trim()) t += `${t?", ":""}Art. ${o.art.trim()}`;
    if(o.no && o.no.trim()) t += `${t?" of ":""}${o.law||"R.A."} ${o.no.trim()}`;
    return {text:t, date:o.date||""};
  }
  return {text:o.text||"", date:o.date||""};
}
function renderOffenses(kind){
  const w = $(kind+"List");
  if(!w) return;
  w.innerHTML = "";
  OFFENSES[kind].forEach((o,i)=>{
    const d = document.createElement("div");
    d.className = "brow";
    d.innerHTML = `<span class="tag">#${i+1}</span>
      <label class="mini grow">Offense <span style="font-weight:400">(e.g., Sec. 5, Art. II of R.A. 9165)</span><input type="text" id="of_${kind}_text_${i}" value="${escAttr(o.text)}" placeholder="Sec. 5, Art. II of R.A. 9165"></label>
      <label class="mini date">Date<input type="date" id="of_${kind}_date_${i}" value="${escAttr(o.date)}"></label>
      ${OFFENSES[kind].length>1?`<button type="button" class="xbtn" title="Remove">✕</button>`:""}`;
    w.appendChild(d);
    ["text","date"].forEach(k=>{
      $(`of_${kind}_${k}_${i}`).addEventListener("input", e=>{
        OFFENSES[kind][i][k] = e.target.value;
        offenseChanged(kind);
      });
    });
    const rmBtn = d.querySelector(".xbtn");
    if(rmBtn) rmBtn.addEventListener("click", ()=>removeOffense(kind, i));
  });
  updateOffPreview(kind);
}
function addOffense(kind){ OFFENSES[kind].push({text:"",date:""}); renderOffenses(kind); }
function removeOffense(kind,i){ OFFENSES[kind].splice(i,1); renderOffenses(kind); }
function includedOffenses(kind){
  return OFFENSES[kind].filter(o=>(o.text||"").trim());
}
function groupCounts(parts){
  /* identical entries are merged into "(n Cts.) …" */
  const uniq = [];
  parts.forEach(p=>{
    const f = uniq.find(u=>u.text===p);
    if(f) f.n++; else uniq.push({text:p, n:1});
  });
  return uniq.map(u=>u.n>1 ? `${u.text} (${u.n} Cts.)` : u.text);
}
function composeOffense(kind){
  const parts = [];
  includedOffenses(kind).forEach(o=>{
    const t = (o.text||"").trim();
    if(t) parts.push("Viol. of " + t);
  });
  if(!parts.length) return "";
  const g = groupCounts(parts);
  if(g.length===1) return g[0];
  const items = g.map((p,i)=>`(${i+1}) ${p}`);
  return items.slice(0,-1).join("; ") + "; and " + items[items.length-1];
}
function composeOffenseDates(kind){
  const rows = includedOffenses(kind);
  const dates = rows.map(o=>fmtDate(o.date));
  if(!dates.some(Boolean)) return "";
  if(rows.length === 1) return dates[0];
  const g = groupCounts(dates.map(d=>d || "___"));
  if(g.length===1) return g[0];
  const items = g.map((d,i)=>`(${i+1}) ${d}`);
  return items.slice(0,-1).join("; ") + "; and " + items[items.length-1];
}
function updateOffPreview(kind){
  const el = $(kind+"Preview");
  if(el){
    const d = composeOffenseDates(kind);
    el.textContent = "Will print as: " + (composeOffense(kind) || "(blank)") + (d ? "  |  Date: " + d : "");
  }
}
function offenseChanged(kind){
  updateOffPreview(kind);
  if(kind === "convicted"){
    buildConditions && buildConditions();
    if(!analysisTouched) regenerateAnalysis(true);
  }
}

/* ---- probation period builder → "THIRTY (30) DAYS" ---- */
const PPERIOD = {y:"", m:"", d:""};
const ONES = ["","ONE","TWO","THREE","FOUR","FIVE","SIX","SEVEN","EIGHT","NINE","TEN","ELEVEN","TWELVE","THIRTEEN","FOURTEEN","FIFTEEN","SIXTEEN","SEVENTEEN","EIGHTEEN","NINETEEN"];
const TENS = ["","","TWENTY","THIRTY","FORTY","FIFTY","SIXTY","SEVENTY","EIGHTY","NINETY"];
function numWords(n){
  n = parseInt(n,10);
  if(isNaN(n) || n<0) return "";
  if(n===0) return "ZERO";
  if(n<20) return ONES[n];
  if(n<100) return TENS[Math.floor(n/10)] + (n%10 ? "-"+ONES[n%10] : "");
  if(n<1000){
    return ONES[Math.floor(n/100)] + " HUNDRED" + (n%100 ? " " + numWords(n%100) : "");
  }
  return String(n);
}
function composePeriod(){
  const has = v => v !== "" && v !== null && !isNaN(parseInt(v,10)) && parseInt(v,10) > 0;
  const parts = [];
  const unit = (v, sing, plur) => {
    const n = parseInt(v,10);
    parts.push(`${numWords(n)} (${n}) ${n===1?sing:plur}`);
  };
  if(has(PPERIOD.y)) unit(PPERIOD.y, "YEAR", "YEARS");
  if(has(PPERIOD.m)) unit(PPERIOD.m, "MONTH", "MONTHS");
  if(has(PPERIOD.d)) unit(PPERIOD.d, "DAY", "DAYS");
  return parts.join(" AND ");
}
function initPeriodInputs(){
  [["pp_y","y"],["pp_m","m"],["pp_d","d"]].forEach(([id,k])=>{
    const el = $(id);
    if(!el) return;
    el.value = PPERIOD[k];
    el.addEventListener("input", e=>{
      PPERIOD[k] = e.target.value;
      updatePeriodPreview();
      buildConditions();
    });
  });
  updatePeriodPreview();
}
function updatePeriodPreview(){
  const el = $("periodPreview");
  if(el) el.textContent = "Will print as: " + (composePeriod() || "(blank)");
}

/* ---- investigating officer picker ---- */
const OFFICERS = [
  ["SrPPO","MIRASOL A. HERBITO"],
  ["PPO2","JOUANA O. EJARES"],
];
function initOfficerSelect(){
  const sel = $("officerSel");
  if(!sel) return;
  const apply = ()=>{
    const custom = sel.value === "__custom";
    ["officerRank","officerName"].forEach(id=>{
      $(id).parentElement.style.display = custom ? "" : "none";
    });
    if(!custom){
      const [r,n] = OFFICERS[parseInt(sel.value,10)];
      $("officerRank").value = r;
      $("officerName").value = n;
    }
  };
  sel.addEventListener("change", apply);
  apply();
}

/* ---- court compose ---- */
function composeCourt(typeId, noId, cityId, provId){
  const t = selVal(typeId, typeId + "Other"), n = val(noId);
  const c = cityId ? val(cityId) : "", pv = provId ? val(provId) : "";
  if(!n && !c && !pv) return "";
  let out = `${t} Branch ${n||"__"}`;
  if(c || pv) out += `, City of ${c||"____"}, ${pv||"____"}`;
  return out;
}

/* ---- select-with-Others helper ---- */
function selVal(selectId, otherId){
  const v = val(selectId);
  return v === "__other" ? val(otherId) : v;
}
function bindOther(selectId, otherId){
  const sel = $(selectId), oth = $(otherId);
  if(!sel || !oth) return;
  const upd = ()=>{ oth.style.display = sel.value === "__other" ? "" : "none"; };
  sel.addEventListener("change", upd);
  upd();
}

/* ---- auto-capitalization on blur ---- */
const CAPS_UPPER = ["lastName","firstName","middleName","judgeName","officerName","cppoName","brOffice"];
const CAPS_TITLE = ["trueName","motherName","fatherName","spouse","sentJudge","occupation",
                    "presentAddress","permanentAddress","residence","courtLocation","sentCourtCity","sentCourtProv"];
const CAPS_SENTENCE = ["features"];
const TITLE_MINOR = new Set(["of","and","the","at","in","on","for","de","del","dela","de la","da","di","la","las","los","ng","sa","y"]);
function smartTitle(s){
  const words = s.split(/(\s+)/);
  let seenWord = false;
  return words.map(w=>{
    if(!w.trim()) return w;
    const lower = w.toLowerCase();
    if(seenWord && TITLE_MINOR.has(lower)){ return lower; }
    seenWord = true;
    return w.replace(/^([("']*)([a-zà-ÿ])/, (m,pre,ch)=>pre+ch.toUpperCase());
  }).join("");
}
function initAutoCaps(){
  document.body.addEventListener("focusout", e=>{
    const id = e.target.id;
    if(!id || e.target.tagName !== "INPUT") return;
    const v = e.target.value;
    if(!v.trim()) return;
    if(CAPS_UPPER.includes(id)) e.target.value = v.toUpperCase();
    else if(CAPS_TITLE.includes(id)) e.target.value = smartTitle(v);
    else if(CAPS_SENTENCE.includes(id)) e.target.value = v.charAt(0).toUpperCase()+v.slice(1);
    else return;
    e.target.dispatchEvent(new Event("input",{bubbles:true}));
  });
}

/* ---- persistent field guides (visible even while typing) ---- */
function initFieldGuides(){
  document.querySelectorAll("main input[placeholder]").forEach(inp=>{
    if(inp.type === "number") return;
    if(inp.closest(".brow,.sentrow,#sentList,#chargedList,#convictedList")) return;
    const hint = document.createElement("div");
    hint.className = "eghint";
    hint.textContent = "Guide: " + inp.placeholder.replace(/^e\.g\.,\s*/,"");
    inp.insertAdjacentElement("afterend", hint);
  });
}

function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
function title(s){ return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }

/* ---- pronouns ---- */
function pronouns(){
  const s = (selVal("sex","sexOther") || "").toLowerCase();
  const female = s.indexOf("male") !== 0;
  return female
    ? {Subj:"She", subj:"she", Pos:"Her", pos:"her", self:"herself"}
    : {Subj:"He", subj:"he", Pos:"His", pos:"his", self:"himself"};
}

/* ---- name helpers ---- */
function fullNameProper(){
  const f = title(val("firstName")), m = title(val("middleName")), l = title(val("lastName"));
  return [f,m,l].filter(Boolean).join(" ");
}
function fullNameCaps(){
  return [val("firstName"), val("middleName"), val("lastName")].filter(Boolean).join(" ").toUpperCase();
}

/* ---- dates ---- */
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function fmtDate(iso){
  if(!iso) return "";
  const [y,m,d] = iso.split("-").map(Number);
  if(!y||!m||!d) return "";
  return `${MONTHS[m-1]} ${d}, ${y}`;
}
function todayISO(){
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;
}
function computeAge(){
  const bd = val("birthday");
  if(!bd) return;
  const ref = val("reportDate") || todayISO();
  const [by,bm,bdd] = bd.split("-").map(Number);
  const [ry,rm,rd] = ref.split("-").map(Number);
  let age = ry - by;
  if(rm < bm || (rm === bm && rd < bdd)) age--;
  if(age >= 0 && age < 130) $("age").value = age + " years old";
}

/* ---- build dynamic UI ---- */
function buildPriorTable(){
  const tb = $("priorBody");
  tb.innerHTML = "";
  AGENCIES.forEach((a,i)=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${a[0]}</td>
      <td><input type="text" id="pr_case_${i}" aria-label="${a[0]} case no."></td>
      <td><input type="text" id="pr_off_${i}" aria-label="${a[0]} offense"></td>
      <td><input type="text" id="pr_date_${i}" aria-label="${a[0]} date charged"></td>
      <td><input type="text" id="pr_status_${i}" placeholder="${a[1]}" aria-label="${a[0]} status"></td>`;
    tb.appendChild(tr);
  });
}

function buildRateGroups(){
  const g = $("rateGrid");
  g.innerHTML = "";
  RATE_GROUPS.forEach(gr=>{
    const div = document.createElement("div");
    div.className = "rate";
    div.innerHTML = `<h4>${gr.title}</h4><div class="body">` +
      gr.opts.map(o=>`<label class="choice ${o===gr.def?'checked':''}">
        <input type="radio" name="rate_${gr.id}" value="${o}" ${o===gr.def?'checked':''}> ${o}</label>`).join("") +
      `</div>`;
    g.appendChild(div);
  });
}

function buildThrusts(){
  const w = $("thrustList");
  w.innerHTML = "";
  THRUSTS.forEach((t,i)=>{
    const l = document.createElement("label");
    l.className = "choice checked";
    l.innerHTML = `<input type="checkbox" id="thrust_${i}" checked> ${t}`;
    w.appendChild(l);
  });
}

function condData(){
  const P = pronouns();
  return {
    ...P,
    period: composePeriod() || "_____",
    officeT: title(val("officeName") || "the Parole and Probation Office"),
    officeAddr: val("officeAddress") || "_____",
    residence: val("residence") || val("presentAddress") || "[residence address]",
  };
}

function buildConditions(){
  const w = $("condList");
  const checkedState = [...w.querySelectorAll("input")].map(i=>i.checked);
  const d = condData();
  w.innerHTML = "";
  CONDITIONS.forEach((fn,i)=>{
    const l = document.createElement("label");
    const on = checkedState.length ? checkedState[i] !== false : true;
    l.className = "choice" + (on ? " checked" : "");
    l.innerHTML = `<input type="checkbox" id="cond_${i}" ${on?"checked":""}> ${fn(d)}`;
    w.appendChild(l);
  });
}

/* ---- analysis template ---- */
function analysisTemplate(){
  const P = pronouns();
  const name = fullNameProper() || "[Petitioner's Name]";
  const offense = composeOffense("convicted") || "[offense convicted of]";
  const office = title(val("officeName") || "the Parole and Probation Office");
  const v = val("recoVerdict");

  if(v === "LEGAL_DQ"){
    return (
`The undersigned investigating officer conducted records checking on the petitioner as part of the investigation process. In the course of the investigation, the petitioner was found to have incurred previous violations bearing Criminal Case No. [case number] for violation of [law violated] and pleaded guilty before the [court, e.g., RTC Branch 19 - Cebu City] on [date of conviction]. ${P.Subj} was sentenced to a penalty of imprisonment of [penalty imposed]. In support of this claim, a copy of the Judgment is attached for your reference, marked as Annex \u201CA\u201D.

That with the petitioner's previous conviction, ${P.subj} is disqualified to avail the benefits of probation under Sec. 9 par. ${groundLetters()} of P.D. 968 as amended by R.A. 10707, hereto quoted. SEC. 9 DISQUALIFIED OFFENDERS. The benefits of this Decree shall not be extended to those:`
    );
  }
  if(v === "MOOT"){
    return (
`During the jail visit conducted on [date of jail visit], the undersigned investigating officer was informed by the [jail facility, e.g., Cebu City Jail Male Dormitory] that the petitioner had been released after fully serving ${P.pos} sentence for the present case. The [jail facility] has issued a Certificate of Detention, which is hereby attached and marked as ANNEX \u201CA\u201D for reference.`
    );
  }
  if(v === "WITHDRAWN"){
    return (
`During the jail visit conducted on [date of jail visit], it was ascertained that the petitioner is currently detained in the [jail facility, e.g., Cebu City Jail Annex Dormitory]. The petitioner has explicitly communicated ${P.pos} deliberate decision to withdraw the probation application due to [reason, e.g., the inability of ${P.pos} family to support the processing of said application]. [Additional findings of the investigation, if any.] In support of ${P.pos} statement, enclosed herewith is the [supporting document, e.g., handwritten letter expressing ${P.pos} intent to withdraw the application], marked as ANNEX \u201CA\u201D.`
    );
  }
  if(v === "DENIED"){
    return (
`Based on the investigation conducted, the petitioner, ${name}, [background and circumstances of the offense]. The investigation, however, disclosed [unfavorable findings, e.g., that the petitioner has shown no remorse and continues to associate with known offenders in the community].

The Classification and Risk Assessment Tool (CARAT) classified the petitioner as a [medium/high]-risk offender. [Discuss factors: weak family or community support, risk of reoffending, need for institutional treatment, or that probation will depreciate the seriousness of the offense committed.]

Considering the foregoing, the ${office} respectfully recommends that the petition for probation be denied, subject to the sound discretion and approval of the Honorable Court.`
    );
  }
  return (
`Based on the investigation conducted, the petitioner, ${name}, is [educational background, e.g., a Grade 9 undergraduate] who [work history, e.g., previously worked as a saleswoman and later accepted laundry and other sideline jobs to support ${P.self}]. ${P.Subj} was generally described by ${P.pos} family and neighbors as a peaceful individual with no history of conflicts. The investigation revealed that ${P.subj} became involved in the violation of ${offense} due to [circumstances, e.g., financial difficulties after being invited by a neighbor]. ${P.Subj} admitted that ${P.subj} [statement of admission, e.g., was unaware that the activity was illegal and participated only to earn additional income].

The petitioner has acknowledged ${P.pos} mistake, expressed genuine remorse, and stated that ${P.subj} intends to [future plans, e.g., seek lawful employment]. The Classification and Risk Assessment Tool (CARAT) indicates that ${P.subj} enjoys close family and community support and has been classified as a [low/medium/high]-risk offender, reflecting a favorable potential for rehabilitation under community-based supervision.

Considering the petitioner's acceptance of responsibility, genuine remorse, strong support system, and low-risk classification, ${P.subj} demonstrates good potential for rehabilitation and successful reintegration into society. Accordingly, the ${office} highly recommends that the petitioner be granted probation, subject to the sound discretion and approval of the Honorable Court.`
  );
}

let analysisTouched = false;
let residenceTouched = false;
function regenerateAnalysis(force){
  if(analysisTouched && force !== true){
    if(!confirm("Replace your edited Analysis text with a fresh template built from the current form details?")) return;
  }
  $("analysisText").value = analysisTemplate();
  if(force !== "silent") analysisTouched = false;
}

/* ---- letterhead / footer image replacement ---- */
const mediaFiles = {};   // zip path -> Uint8Array
const ALL_SLOTS = [Object.assign({mount:"photoSlotMount",
  note:"Shown beside the letterhead of the PSIR page. Upload the petitioner\u2019s 2x2 picture \u2014 it is fitted into the frame automatically. If left empty, a gray \u201c2x2 PHOTO\u201d placeholder is printed.",
  empty:"No picture yet \u2014 a gray placeholder will be printed."}, PHOTO_SLOT)]
  .concat(MEDIA_SLOTS);
function buildMediaSlots(){
  ALL_SLOTS.forEach((m,i)=>{
    const g = $(m.mount || "mediaGrid");
    if(!g) return;
    const d = document.createElement("div");
    d.className = "mslot";
    d.innerHTML = `<img id="mthumb_${i}" src="${m.thumb}" alt="">
      <div><b>${m.label}</b><br><span class="dim">${m.note ? m.note : m.w+"\u00D7"+m.h+"px \u2014 replacement is auto-fitted"}</span></div>
      <input type="file" accept="image/*" id="mfile_${i}">
      <span class="dim" id="mstat_${i}">${m.empty || "Using the original image."}</span>`;
    g.appendChild(d);
    $("mfile_"+i).addEventListener("change", e=>{
      const f = e.target.files[0];
      if(!f) return;
      pickMedia(m, i, f);
    });
  });
}
function pickMedia(slot, i, file){
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = ()=>{
    const cv = document.createElement("canvas");
    cv.width = slot.w; cv.height = slot.h;
    const cx = cv.getContext("2d");
    if(slot.mime === "image/jpeg"){ cx.fillStyle = "#fff"; cx.fillRect(0,0,slot.w,slot.h); }
    const sc = Math.min(slot.w/img.width, slot.h/img.height);
    const w = img.width*sc, h = img.height*sc;
    cx.drawImage(img, (slot.w-w)/2, (slot.h-h)/2, w, h);
    cv.toBlob(async b=>{
      mediaFiles[slot.path] = new Uint8Array(await b.arrayBuffer());
      $("mthumb_"+i).src = cv.toDataURL();
      const stat = $("mstat_"+i);
      stat.textContent = "\u2713 Will be replaced. ";
      const undo = document.createElement("a");
      undo.href = "#";
      undo.textContent = "Undo";
      undo.addEventListener("click", e=>{ e.preventDefault(); resetMedia(i); });
      stat.appendChild(undo);
      URL.revokeObjectURL(url);
    }, slot.mime, 0.92);
  };
  img.onerror = ()=>{ $("mstat_"+i).textContent = "Could not read that image."; URL.revokeObjectURL(url); };
  img.src = url;
}
function resetMedia(i){
  const m = ALL_SLOTS[i];
  delete mediaFiles[m.path];
  $("mthumb_"+i).src = m.thumb;
  $("mfile_"+i).value = "";
  $("mstat_"+i).textContent = m.empty || "Using the original image.";
}

/* ---- live caption + listeners ---- */
function refreshCaption(){
  $("capName").textContent = fullNameCaps() || "—";
  $("capDocket").textContent = val("docketNo") || "—";
  $("capCase").textContent = val("criminalCaseNo") || "—";
}

const ANALYSIS_DEPS = ["sex","firstName","middleName","lastName","officeName","recoVerdict"];
const CONDITION_DEPS = ["presentAddress","officeName","officeAddress","sex","residence"];

function initListeners(){
  document.body.addEventListener("input", e=>{
    const id = e.target.id;
    if(id === "analysisText"){ analysisTouched = true; return; }
    if(id === "residence"){ residenceTouched = true; }
    refreshCaption();
    if(["birthday","reportDate"].includes(id)) computeAge();
    if(id === "presentAddress" && !residenceTouched && $("residence")) $("residence").value = e.target.value;
    if(CONDITION_DEPS.includes(id)) buildConditions();
    if(id==="courtCity"||id==="courtProv"){
      const el2 = $("courtLocPreview");
      if(el2) el2.textContent = "Prints as: City of " + (val("courtCity")||"___") + ", " + (val("courtProv")||"___");
    }
    if(id==="sentCourtCity"||id==="sentCourtProv"){
      const el3 = $("sentCourtLocPreview");
      if(el3) el3.textContent = "Prints as: City of " + (val("sentCourtCity")||"___") + ", " + (val("sentCourtProv")||"___");
    }
    /* auto-refresh the analysis template (pronouns, name, offense, office)
       as long as the user hasn't manually edited it */
    if(ANALYSIS_DEPS.includes(id) && !analysisTouched) regenerateAnalysis(true);
  });
  document.body.addEventListener("change", e=>{
    if(e.target.matches(".choice input")){
      const box = e.target;
      if(box.type === "radio"){
        [...document.getElementsByName(box.name)].forEach(r=>r.closest(".choice").classList.toggle("checked", r.checked));
      } else {
        box.closest(".choice").classList.toggle("checked", box.checked);
      }
    }
    if(e.target.name === "custodial"){
      const ror = e.target.value === "ROR";
      const det = e.target.value === "Detention";
      document.querySelectorAll(".ror-only").forEach(el=>el.style.display = ror ? "" : "none");
      document.querySelectorAll(".det-only").forEach(el=>el.style.display = det ? "" : "none");
    }
    if(e.target.id === "sex"){
      buildConditions();
      if(!analysisTouched) regenerateAnalysis(true);
    }
    if(e.target.id === "recoVerdict"){
      updateVerdictUI();
      if(!analysisTouched) regenerateAnalysis(true);
    }
    if(e.target.id && e.target.id.startsWith("dq_")){
      if(!analysisTouched) regenerateAnalysis(true);
    }
  });
  const links = [...document.querySelectorAll("#sideNav a")];
  const secs = links.map(a=>document.querySelector(a.getAttribute("href")));
  const io = new IntersectionObserver(es=>{
    es.forEach(en=>{
      if(en.isIntersecting){
        links.forEach(l=>l.classList.toggle("on", l.getAttribute("href") === "#"+en.target.id));
      }
    });
  }, {rootMargin:"-30% 0px -60% 0px"});
  secs.forEach(s=>s && io.observe(s));
}

/* ---- init ---- */
window.addEventListener("DOMContentLoaded", ()=>{
  const t = todayISO();
  ["reportDate","datePrepared","dateApproved"].forEach(id=>$(id).value = t);
  buildPriorTable();
  buildRateGroups();
  buildThrusts();
  buildConditions();
  buildDqList();
  buildMediaSlots();
  updateVerdictUI();
  renderSentences();
  renderOffenses("charged");
  renderOffenses("convicted");
  initPeriodInputs();
  initOfficerSelect();
  initAutoCaps();
  initFieldGuides();
  [["civilStatus","civilOther"],["religion","religionOther"],["nationality","nationalityOther"],
   ["sex","sexOther"],["genderPref","genderPrefOther"],
   ["courtType","courtTypeOther"],["sentCourtType","sentCourtTypeOther"]]
    .forEach(([a,b])=>bindOther(a,b));
  const cs = $("civilStatus");
  if(cs){
    const syncSpouse = ()=>{
      const sp = $("spouse");
      if(cs.value === "Single"){ sp.value = "Not Applicable"; }
      else if(sp.value === "Not Applicable"){ sp.value = ""; }
    };
    cs.addEventListener("change", syncSpouse);
    syncSpouse();
  }
  regenerateAnalysis(true);
  refreshCaption();
  initListeners();

  // CSP forbids inline onclick="..." in the production build, so these are
  // wired here instead of as HTML attributes.
  $("addChargedBtn").addEventListener("click", ()=>addOffense("charged"));
  $("addConvictedBtn").addEventListener("click", ()=>addOffense("convicted"));
  $("addSentenceBtn").addEventListener("click", addSentence);
  $("regenAnalysisBtn").addEventListener("click", ()=>regenerateAnalysis());
  $("genBtn").addEventListener("click", generateDocx);

  window.parent.postMessage({ type: "psir:ready" }, "*");
});

/* ================= DOCX GENERATION (template fill) =================
   V4: the embedded template is built directly from the office's
   PSIR sample (PPA FORM 3, Revision 002) so fonts, logos, headers,
   tables, spacing and alignment match it exactly. [[TOKENS]] stand
   in for the case-specific values; generation = unzip, swap tokens,
   re-zip. The petitioner's photo slot is word/media/image1.jpeg. */

function xesc(s){
  return String(s ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,"")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
function b64ToU8(b64){
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/* --- paragraph surgery on OOXML strings --- */
function paraBounds(xml, token){
  const i = xml.indexOf(token);
  if(i < 0) return null;
  const s = Math.max(xml.lastIndexOf("<w:p ", i), xml.lastIndexOf("<w:p>", i));
  const e = xml.indexOf("</w:p>", i);
  if(s < 0 || e < 0) return null;
  return [s, e + 6];
}
function getPara(xml, token){ const b = paraBounds(xml, token); return b ? xml.slice(b[0], b[1]) : null; }
function removePara(xml, token){ const b = paraBounds(xml, token); return b ? xml.slice(0, b[0]) + xml.slice(b[1]) : xml; }
function replacePara(xml, token, repl){ const b = paraBounds(xml, token); return b ? xml.slice(0, b[0]) + repl + xml.slice(b[1]) : xml; }
function insertAfterPara(xml, token, insert){ const b = paraBounds(xml, token); return b ? xml.slice(0, b[1]) + insert + xml.slice(b[1]) : xml; }
const swap = (xml, token, value) => xml.split(token).join(value);
let _fitCtx;
function fitOffenseHalfPt(text){
  // returns a Word half-point size (22 = 11pt) that keeps `text` on one line
  // inside the Charged/Convicted value cell (~2.87in wide); floor 8pt.
  if(!text) return 22;
  try{
    if(!_fitCtx) _fitCtx = document.createElement("canvas").getContext("2d");
    const cellPx = 258; // usable cell width in CSS px (cell minus side margins)
    for(const pt of [11,10.5,10,9.5,9,8.5,8]){
      _fitCtx.font = pt + "pt Arial";
      if(_fitCtx.measureText(text).width <= cellPx) return Math.round(pt*2);
    }
    return 16; // 8pt floor — very long entries wrap
  }catch(e){
    // no canvas: rough character-count fallback
    const n = text.length;
    return n<=38?22 : n<=42?21 : n<=46?20 : n<=50?19 : n<=55?18 : n<=60?17 : 16;
  }
}

function buildTokenMap(){
  const P = pronouns();
  const cust = (document.querySelector("input[name=custodial]:checked")||{}).value || "Bail";
  const CHK = " x ";
  const letterDate = fmtDate(val("reportDate"));
  const present = val("presentAddress");
  const last = val("lastName"), first = val("firstName"), mid = val("middleName");
  const trueName = val("trueName") ||
    [title(last), [title(first), title(mid)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const map = {
    NAME_CAPS: fullNameCaps(), DOCKET: val("docketNo"), CASE_NO: val("criminalCaseNo"),
    LETTER_DATE: letterDate,
    JUDGE_NAME: val("judgeName").toUpperCase(), JUDGE_POS: val("judgePosition"),
    COURT_BRANCH: composeCourt("courtType","courtBranchNo"), COURT_LOC: (val("courtCity")||val("courtProv")) ? `City of ${val("courtCity")||"____"}, ${val("courtProv")||"____"}` : "",
    ORDER_DATE: fmtDate(val("orderDate")), RECEIVED_DATE: fmtDate(val("receivedDate")),
    OFF_RANK: val("officerRank"), OFF_NAME: val("officerName").toUpperCase(), OFF_TITLE: val("officerTitle"),
    CPPO_NAME: val("cppoName").toUpperCase(), CPPO_TITLE: val("cppoTitle"),
    LAST: last.toUpperCase(), FIRST: first.toUpperCase(), MID: mid.toUpperCase(),
    TRUE_NAME: trueName, ALIAS: (a=>a?`\u201C${a}\u201D`:"")(val("alias").replace(/^[\"\u201C\u2018']+|[\"\u201D\u2019']+$/g,"").trim()), EDU: val("education"), SEX: selVal("sex","sexOther"),
    RELIGION: selVal("religion","religionOther"), GPREF: selVal("genderPref","genderPrefOther"), OCCUP: val("occupation"),
    BDAY: fmtDate(val("birthday")), NATION: selVal("nationality","nationalityOther"), AGE: val("age"),
    MOTHER: val("motherName"), CIVIL: selVal("civilStatus","civilOther"), FATHER: val("fatherName"),
    SPOUSE: val("spouse"), FEATURES: val("features"),
    PRES_ADDR: present, PERM_ADDR: val("permanentAddress") || present,
    CHARGED: composeOffense("charged"), CHARGED_DATE: composeOffenseDates("charged"),
    CHARGED_SZ: String(fitOffenseHalfPt(composeOffense("charged"))),
    CONVICTED_SZ: String(fitOffenseHalfPt(composeOffense("convicted"))),
    CONVICTED: composeOffense("convicted"), CONV_DATE: composeOffenseDates("convicted"),
    SENTENCE: composeSentence(), SENT_JUDGE: val("sentJudge"), SENT_COURT: composeCourt("sentCourtType","sentBranchNo","sentCourtCity","sentCourtProv"),
    XB: cust === "Bail" ? CHK : "  ",
    XD: cust === "Detention" ? CHK : "  ",
    XR: cust === "ROR" ? CHK : "    ",
    DET_FAC: (cust === "Detention" && val("detFacility")) ? ` \u2013 ${val("detFacility")}` : "",
    ROR_CUST: (cust === "ROR" && val("rorCustodian")) ? val("rorCustodian") : "____________________________________________________",
    ROR_ADDR: val("custodialAddress") ? val("custodialAddress") : "___________________________________________________________",
    PERIOD: composePeriod(), RESIDENCE: val("residence") || present,
    OFFICE_T: title(val("officeName")), OFFICE_ADDR: val("officeAddress"),
    Subj: P.Subj, Pos: P.Pos, pos: P.pos, self: P.self,
    H_REGION: val("brRegion"), H_REGION2: val("brRegion2"),
    H_OFFICE: val("brOffice").toUpperCase(), H_ADDR: val("brAddr"),
    H_TEL: val("brTel"), H_EMAIL: val("brEmail"), H_WEB: val("brWeb"),
    TH_HEAD: "", REC_NUM: "VI.",
    WF_TRUE: (val("trueName") ? ` whose true name is ${val("trueName")},` : ""),
    SIGN_PLACE: val("signPlace"), SIGN_DATE: letterDate,
    DATE_PREP: fmtDate(val("datePrepared")), DATE_APPR: fmtDate(val("dateApproved")),
    REVOC: "",
  };
  // prior records
  AGENCIES.forEach((a,i)=>{
    map[`PRC_${i}`] = val(`pr_case_${i}`);
    map[`PRO_${i}`] = val(`pr_off_${i}`);
    map[`PRD_${i}`] = val(`pr_date_${i}`);
    map[`PRS_${i}`] = val(`pr_status_${i}`);
  });
  // socio-economic checkmarks
  const sels = RATE_GROUPS.map(g=>(document.querySelector(`input[name=rate_${g.id}]:checked`)||{}).value || g.def);
  SE_MANIFEST.forEach(m=>{
    map[m.token.slice(2,-2)] = (sels[m.group] === m.option) ? "x" : "";
  });
  return map;
}

function processBody(xml){
  /* --- IV. Analysis: clone the prototype paragraph per user paragraph --- */
  const proto = getPara(xml, "[[AN_P]]");
  if(proto){
    const blank = proto.split("[[AN_P]]").join("");
    const paras = $("analysisText").value.trim().split(/\n\s*\n/)
      .map(p=>xesc(p.replace(/\n/g," ").trim())).filter(Boolean);
    const lastProto = proto.replace(' w:after="240"', '');
    const chunk = paras.length
      ? paras.map((t,i)=>((i === paras.length-1) ? lastProto : proto).split("[[AN_P]]").join(t)).join("")
      : blank;
    xml = replacePara(xml, "[[AN_P]]", chunk);
  }

  const verdict = val("recoVerdict");
  const granted = verdict === "GRANTED";

  /* --- Legal Disqualification quote block (after the Analysis paragraphs) --- */
  if(verdict === "LEGAL_DQ"){
    const sel = selectedGrounds();
    const proto = getPara(xml, "[[DQ_ITEM]]");
    if(proto && sel.length){
      const texts = sel.map(g=>`${g[0]}. ${g[1]}`);
      const lastIx = texts.length - 1;
      texts[lastIx] = texts[lastIx].replace(/;\s*$/, ".");
      const clones = texts.map(t=>proto.split("[[DQ_ITEM]]").join(xesc(t))).join("");
      xml = replacePara(xml, "[[DQ_ITEM]]", clones);
    } else {
      xml = removePara(xml, "[[DQ_ITEM]]");
    }
  } else {
    xml = removePara(xml, "[[DQ_ITEM]]");
  }

  /* --- V. Thrusts: fill / remove / extras; "Not Applicable" when denied --- */
  if(granted){
    xml = removePara(xml, "[[TH_NA]]");
    const thProto = getPara(xml, "[[TH_0]]");
    const extraThrusts = val("thrustExtra").split("\n").map(s=>s.trim()).filter(Boolean);
    if(thProto && extraThrusts.length){
      const clones = extraThrusts.map(t=>thProto.split("[[TH_0]]").join(xesc(t))).join("");
      xml = insertAfterPara(xml, "[[TH_9]]", clones);
    }
    for(let k=0;k<10;k++){
      const tok = `[[TH_${k}]]`;
      xml = $(`thrust_${k}`).checked ? swap(xml, tok, xesc(THRUSTS[k])) : removePara(xml, tok);
    }
  } else {
    xml = swap(xml, "[[TH_NA]]", "Not Applicable");
    for(let k=0;k<10;k++) xml = removePara(xml, `[[TH_${k}]]`);
  }

  /* --- VI. Conditions --- */
  if(granted){
    xml = swap(xml, "[[SUBJECT_TO]]", ", subject to the following conditions:");
    const extra = val("condExtra").split("\n").map(s=>s.trim()).filter(Boolean);
    const cProto = getPara(xml, "[[COND_EXTRA]]");
    if(cProto && extra.length){
      const clones = extra.map(t=>cProto.split("[[COND_EXTRA]]").join(xesc(t))).join("");
      xml = replacePara(xml, "[[COND_EXTRA]]", clones);
    } else {
      xml = removePara(xml, "[[COND_EXTRA]]");
    }
    for(let k=0;k<14;k++){
      const tok = `[[C_${k}]]`;
      xml = $(`cond_${k}`).checked ? swap(xml, tok, "") : removePara(xml, tok);
    }
  } else {
    if(verdict === "MOOT") xml = swap(xml, "[[VERDICT]]", "considered MOOT and ACADEMIC");
    else if(verdict === "WITHDRAWN") xml = swap(xml, "[[VERDICT]]", "WITHDRAWN");
    else xml = swap(xml, "[[VERDICT]]", "DENIED");
    xml = swap(xml, "[[SUBJECT_TO]]", ".");
    for(let k=0;k<14;k++) xml = removePara(xml, `[[C_${k}]]`);
    xml = removePara(xml, "[[COND_EXTRA]]");
    xml = removePara(xml, "[[REVOC]]");
  }
  return xml;
}

async function generateDocx(){
  const btn = $("genBtn"), msg = $("genMsg");
  msg.className = "msg";
  if(!val("lastName") && !val("firstName")){
    const text = "Please enter the petitioner's name first (Section I).";
    msg.textContent = text;
    msg.className = "msg err";
    $("lastName").focus();
    // Also surface this to the host app (see HOST BRIDGE below) — the React
    // modal wraps this generator in an <iframe>, where this in-page message
    // is easy to miss if the field is scrolled out of view.
    window.parent.postMessage({ type: "psir:error", payload: text }, "*");
    return;
  }
  btn.disabled = true;
  msg.textContent = "Filling in the PPA Form 3 template…";
  try{
    const zip = await JSZip.loadAsync(b64ToU8(TEMPLATE_B64));
    const map = buildTokenMap();
    const names = Object.keys(zip.files).filter(n=>n.startsWith("word/") && n.endsWith(".xml"));
    for(const name of names){
      let xml = await zip.file(name).async("string");
      if(!xml.includes("[[")) continue;
      if(name === "word/document.xml") xml = processBody(xml);
      for(const [k,v] of Object.entries(map)) xml = swap(xml, `[[${k}]]`, xesc(v));
      xml = swap(xml, "[[VERDICT]]", "GRANTED"); // (granted path; denied handled in processBody)
      const leftover = xml.match(/\[\[[A-Za-z_0-9]+\]\]/);
      if(leftover) console.warn("Unfilled token in", name, leftover[0]);
      zip.file(name, xml);
    }
    for(const [path, u8] of Object.entries(mediaFiles)) zip.file(path, u8);
    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const data = { last: val("lastName") || "PETITIONER", first: val("firstName") };
    const fname = `PSIR_${data.last.toUpperCase()}_${data.first.toUpperCase()}`.replace(/\s+/g,"_").replace(/_+$/,"") + ".docx";
    const buf = await blob.arrayBuffer();
    const base64 = u8ToB64(new Uint8Array(buf));
    window.parent.postMessage({ type: "psir:generated", payload: { base64, filename: fname, snapshot: collectSnapshot() } }, "*");
    msg.textContent = `Done — ${fname} generated. Saving…`;
  }catch(err){
    console.error(err);
    const text = "Something went wrong: " + err.message;
    msg.textContent = text;
    msg.className = "msg err";
    window.parent.postMessage({ type: "psir:error", payload: text }, "*");
  }finally{
    btn.disabled = false;
  }
}



/* ================= HOST BRIDGE (Electron app integration) =================
   The React app hosts this generator inside an <iframe>. It prefills the
   form from the probationer's saved PSIR profile + office defaults, and
   receives the generated .docx (as base64) plus a full field snapshot to
   persist back to the probationer's record instead of triggering a browser
   download. */

function u8ToB64(u8) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function collectSnapshot() {
  const fields = {};
  document.querySelectorAll("main input[id], main select[id], main textarea[id]").forEach(el => {
    if (el.type === "radio") return;
    fields[el.id] = el.type === "checkbox" ? el.checked : el.value;
  });
  const radios = {};
  document.querySelectorAll('main input[type="radio"][name]:checked').forEach(el => { radios[el.name] = el.value; });
  const media = {};
  Object.entries(mediaFiles).forEach(([path, u8]) => { media[path] = u8ToB64(u8); });
  return { fields, radios, offenses: OFFENSES, sentences: SENTENCES, media };
}

function applyPrefill(p) {
  if (!p) return;
  Object.entries(p.fields || {}).forEach(([id, v]) => {
    const el = $(id);
    if (!el) return;
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v ?? "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  Object.entries(p.radios || {}).forEach(([name, value]) => {
    const el = document.querySelector(`input[type="radio"][name="${CSS.escape(name)}"][value="${CSS.escape(value)}"]`);
    if (el) { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  if (p.offenses && Array.isArray(p.offenses.charged) && p.offenses.charged.length) OFFENSES.charged = p.offenses.charged.map(migrateOffenseRow);
  if (p.offenses && Array.isArray(p.offenses.convicted) && p.offenses.convicted.length) OFFENSES.convicted = p.offenses.convicted.map(migrateOffenseRow);
  renderOffenses("charged");
  renderOffenses("convicted");
  if (Array.isArray(p.sentences) && p.sentences.length) SENTENCES = p.sentences;
  renderSentences();
  if (p.media) {
    Object.entries(p.media).forEach(([path, b64]) => {
      mediaFiles[path] = b64ToU8(b64);
      const idx = ALL_SLOTS.findIndex(s => s.path === path);
      if (idx >= 0 && $("mthumb_" + idx)) {
        $("mthumb_" + idx).src = "data:" + ALL_SLOTS[idx].mime + ";base64," + b64;
        if ($("mstat_" + idx)) $("mstat_" + idx).innerHTML = "\u2713 Loaded from saved profile.";
      }
    });
  }
  refreshCaption();
  computeAge();
  buildConditions();
  if (!analysisTouched) regenerateAnalysis(true);
}

window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "psir:prefill") {
    applyPrefill(msg.payload || {});
  } else if (msg.type === "psir:requestSnapshot") {
    window.parent.postMessage({ type: "psir:snapshot", payload: collectSnapshot() }, "*");
  }
});
