var MEDIA_KEYS = ["seal","bagong","iso","cert","banner"];
var MEDIA_ORIG = {};
MEDIA_KEYS.forEach(function(k){ MEDIA_ORIG[k] = {b64: MEDIA[k].b64, type: MEDIA[k].type}; });

/* ================= helpers ================= */
function $(id){ return document.getElementById(id); }
function val(id){ var e = $(id); return e ? e.value.trim() : ""; }

var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function fmtDate(iso){
  if(!iso) return "";
  var p = iso.split("-").map(Number);
  if(!p[0]||!p[1]||!p[2]) return "";
  return MONTHS[p[1]-1] + " " + p[2] + ", " + p[0];
}
function todayISO(){
  var t = new Date();
  return t.getFullYear() + "-" + String(t.getMonth()+1).padStart(2,"0") + "-" + String(t.getDate()).padStart(2,"0");
}
function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
function title(s){ return s.toLowerCase().replace(/\b\w/g, function(c){ return c.toUpperCase(); }); }

/* ---- pronouns ---- */
function pronouns(){
  var female = val("sex") === "Female";
  return female
    ? {Subj:"She", subj:"she", Pos:"Her", pos:"her", obj:"her", self:"herself"}
    : {Subj:"He", subj:"he", Pos:"His", pos:"his", obj:"him", self:"himself"};
}

/* ---- name helpers ---- */
function fullNameCaps(){
  return [val("firstName"), val("middleName"), val("lastName")].filter(Boolean).join(" ").toUpperCase();
}
function aliasQuoted(){
  var a = val("alias");
  return a ? "\u201C" + a.toUpperCase() + "\u201D" : "";
}
function nameWithAlias(){
  var n = fullNameCaps();
  var a = aliasQuoted();
  return a ? n + " a.k.a. " + a : n;
}

/* ---- age auto-compute ---- */
function computeAge(){
  var bd = val("birthday");
  if(!bd) return;
  var ref = val("reportDate") || todayISO();
  var b = bd.split("-").map(Number), r = ref.split("-").map(Number);
  var age = r[0] - b[0];
  if(r[1] < b[1] || (r[1] === b[1] && r[2] < b[2])) age--;
  if(age >= 0 && age < 130) $("age").value = age + " Years Old";
}

/* ---- select-with-Others helper ---- */
function selVal(selectId, otherId){
  var v = val(selectId);
  return v === "__other" ? val(otherId) : v;
}
function bindOther(selectId, otherId){
  var sel = $(selectId), oth = $(otherId);
  if(!sel || !oth) return;
  var upd = function(){ oth.style.display = sel.value === "__other" ? "" : "none"; };
  sel.addEventListener("change", upd);
  upd();
}

/* ---- auto-capitalization on blur ---- */
var CAPS_UPPER = ["lastName","firstName","middleName","judgeName","officerName","cppoName","brOffice"];
var CAPS_TITLE = ["probAddr","courtCity","courtProv","grantJudgeName","grantCity","grantProv","signPlace"];
var TITLE_MINOR = new Set(["of","and","the","at","in","on","for","de","del","dela","de la","da","di","la","las","los","ng","sa","y"]);
function smartTitle(s){
  var words = s.split(/(\s+)/);
  var seenWord = false;
  return words.map(function(w){
    if(!w.trim()) return w;
    var lower = w.toLowerCase();
    if(seenWord && TITLE_MINOR.has(lower)){ return lower; }
    seenWord = true;
    return w.replace(/^([("']*)([a-zà-ÿ])/, function(m,pre,ch){ return pre+ch.toUpperCase(); });
  }).join("");
}
function initAutoCaps(){
  document.body.addEventListener("focusout", function(e){
    var id = e.target.id;
    if(!id || e.target.tagName !== "INPUT") return;
    var v = e.target.value;
    if(!v.trim()) return;
    if(CAPS_UPPER.includes(id)) e.target.value = v.toUpperCase();
    else if(CAPS_TITLE.includes(id)) e.target.value = smartTitle(v);
    else return;
    e.target.dispatchEvent(new Event("input",{bubbles:true}));
  });
}

/* ---- persistent field guides (visible even while typing) ---- */
function initFieldGuides(){
  document.querySelectorAll("main input[placeholder]").forEach(function(inp){
    if(inp.type === "number") return;
    if(inp.closest && inp.closest(".drow")) return;
    var hint = document.createElement("div");
    hint.className = "eghint";
    hint.textContent = "Guide: " + inp.placeholder.replace(/^e\.g\.,\s*/,"");
    inp.insertAdjacentElement("afterend", hint);
  });
}

/* ---- supervising officer picker ---- */
var OFFICERS = [
  ["SrPPO","MIRASOL A. HERBITO"],
  ["PPO2","JOUANA O. EJARES"],
];
function initOfficerSelect(){
  var sel = $("officerSel");
  if(!sel) return;
  var apply = function(){
    var custom = sel.value === "__custom";
    ["officerRank","officerName"].forEach(function(id){
      $(id).parentElement.style.display = custom ? "" : "none";
    });
    if(!custom){
      var rn = OFFICERS[parseInt(sel.value,10)];
      $("officerRank").value = rn[0];
      $("officerName").value = rn[1];
    }
  };
  sel.addEventListener("change", apply);
  apply();
}
function officerFull(){
  return (val("officerRank") + " " + val("officerName")).trim().toUpperCase();
}

/* ---- offense / period / grant-judge composers ---- */
var NUMWORDS = ["Zero","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen","Twenty","Twenty-One","Twenty-Two","Twenty-Three","Twenty-Four","Twenty-Five","Twenty-Six","Twenty-Seven","Twenty-Eight","Twenty-Nine","Thirty","Thirty-One"];
function numWord(n){ return NUMWORDS[n] || String(n); }
function joinAnd(parts){
  if(parts.length <= 1) return parts.join("");
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}
function composePeriod(){
  var y = parseInt(val("periodYears"), 10);
  var m = parseInt(val("periodMonths"), 10);
  var d = parseInt(val("periodDays"), 10);
  var parts = [];
  if(y > 0) parts.push(numWord(y) + " (" + y + ") Year" + (y > 1 ? "s" : ""));
  if(m > 0) parts.push(numWord(m) + " (" + m + ") Month" + (m > 1 ? "s" : ""));
  if(d > 0) parts.push(numWord(d) + " (" + d + ") Day" + (d > 1 ? "s" : ""));
  return joinAnd(parts);
}
function addCaseRow(v){
  var box = $("caseRows");
  if(!box) return;
  var d = document.createElement("div"); d.className = "drow";
  d.className = "drow case";
  d.innerHTML = '<input type="text" class="caseInput" placeholder="e.g., NCR-ODT-2022-551">' +
    '<button type="button" class="rm" title="Remove">✕</button>';
  d.querySelector(".rm").onclick = function(){ d.remove(); updateComposerPreviews(); refreshCaption(); };
  d.querySelector("input").value = v || "";
  box.appendChild(d);
}
function composeCases(){
  return [].slice.call(document.querySelectorAll("#caseRows .caseInput"))
    .map(function(i){ return i.value.trim(); }).filter(Boolean).join(" & ");
}
function addOffenseRow(){
  var box = $("offenseRows");
  if(!box) return;
  var d = document.createElement("div"); d.className = "drow";
  d.innerHTML = '<select class="offMode"><option value="ra">Viol. of R.A.</option><option value="custom">Custom text</option></select>' +
    '<input type="text" class="offSecs" placeholder="Sec(s). e.g., 11">' +
    '<input type="text" class="offArt" placeholder="Art. e.g., II">' +
    '<input type="text" class="offRA" placeholder="R.A. e.g., 9165">' +
    '<input type="text" class="offCustom" placeholder="e.g., Theft under Art. 308 of the Revised Penal Code" style="display:none">' +
    '<button type="button" class="rm" title="Remove">✕</button>';
  var sel = d.querySelector(".offMode");
  sel.onchange = function(){
    var c = sel.value === "custom";
    d.querySelector(".offSecs").style.display = c ? "none" : "";
    d.querySelector(".offArt").style.display = c ? "none" : "";
    d.querySelector(".offRA").style.display = c ? "none" : "";
    d.querySelector(".offCustom").style.display = c ? "" : "none";
    updateComposerPreviews();
  };
  d.querySelector(".rm").onclick = function(){ d.remove(); updateComposerPreviews(); };
  box.appendChild(d);
}
function composeOffenses(){
  var out = [], order = {};
  [].slice.call(document.querySelectorAll("#offenseRows .drow")).forEach(function(d){
    if(d.querySelector(".offMode").value === "custom"){
      var t = d.querySelector(".offCustom").value.trim();
      if(t) out.push({custom: t});
      return;
    }
    var secs = d.querySelector(".offSecs").value.trim();
    var art = d.querySelector(".offArt").value.trim();
    var ra = d.querySelector(".offRA").value.trim();
    if(!secs && !ra) return;
    var key = art + "|" + ra;
    if(key in order){ if(secs) out[order[key]].secs.push(secs); }
    else { order[key] = out.length; out.push({secs: secs ? [secs] : [], art: art, ra: ra}); }
  });
  return joinAnd(out.map(function(g){
    if(g.custom) return g.custom;
    var secsAll = g.secs.join(" & ");
    var plural = g.secs.length > 1 || /[&,\-]| and /i.test(secsAll);
    return "Viol. of " + (plural ? "Secs. " : "Sec. ") + (secsAll || "__") +
           (g.art ? ", Art. " + g.art : "") + " of R.A. " + (g.ra || "____");
  }));
}
function cityOf(cityId, provId){
  var c = val(cityId), p = val(provId);
  if(!c) return "";
  return "City of " + c + (p ? ", " + p : "");
}
function composeGrantJudge(){
  var n = val("grantJudgeName");
  var line1 = n ? "Hon. " + n + "," : "__________";
  var br = val("grantBranchNo");
  var court = val("grantCourtType") + (br ? "-Br. " + br : "");
  var line2 = [court, cityOf("grantCity","grantProv")].filter(Boolean).join(", ") || "__________";
  return [line1, line2];
}
function updateComposerPreviews(){
  var cp = $("casePreview");
  if(cp) cp.textContent = "Prints as: " + (composeCases() || "\u2014");
  var op = $("offensePreview");
  if(op) op.textContent = "Prints as: " + (composeOffenses() || "\u2014");
  var pp = $("periodPreview");
  if(pp) pp.textContent = "Prints as: " + (composePeriod() || "\u2014");
  var gp = $("grantPreview");
  if(gp){ var g = composeGrantJudge(); gp.textContent = "Prints as: " + g[0] + " " + g[1]; }
}

/* ---- court compose ---- */
function composeBranch(){
  var t = val("courtType"), n = val("courtBranchNo");
  return t + " Branch " + (n || "__");
}
function updateCourtPreview(){
  var el = $("courtPreview");
  if(el) el.textContent = "Prints as: " + composeBranch() + (cityOf("courtCity","courtProv") ? " — " + cityOf("courtCity","courtProv") : "");
}

/* ================= default section text ================= */
var DEF_C = [
"Monthly report-in-person;",
"Scheduled and unscheduled home visits;",
"Individual life-coaching sessions geared towards developing client\u2019s emotional, social, mental, and psychological well-being;",
"Community work services (CWS) in the barangay, and participation in tree planting and other socio-civic activities;",
"Therapeutic Community Ladderized Program; and/or",
"Other reinforcing rehabilitation programs to be initiated by the Parole and Probation Administration, whichever is fitting to the rehabilitation needs of client."
].join("\n");

function defaultD(){
  var p = pronouns();
  return "Throughout " + p.pos + " probation period, the probationer has demonstrated obedience and adherence to the instructions provided to " + p.obj + ". Without exception, " + p.subj + " has attended the monthly reporting schedules and has exhibited active engagement in various office-initiated activities. The supervising officer has encountered no challenges in managing " + p.pos + " supervision, as " + p.subj + " consistently displays positive behavior and commitment to fulfill the probation conditions imposed on " + p.obj + ".\n\nThere have been no complaints reported to the office regarding the probationer\u2019s reintegration into the community. Additionally, " + p.subj + " has fulfilled " + p.pos + " familial responsibilities. This indicates that the probationer demonstrated a proactive approach to community reintegration and responsible citizenship.";
}
function defaultE(){
  var p = pronouns();
  return "The probationer has substantially complied with the minimum requirements essential for the termination of " + p.pos + " probation. Furthermore, throughout the duration of " + p.pos + " probation period, no derogatory reports or complaints were received against " + p.obj + ", reflecting " + p.pos + " positive response to community-based rehabilitation. Therefore, it is recommended that " + p.pos + " probation supervision be formally concluded without a need for an extension, acknowledging " + p.pos + " successful adherence to the stipulated terms.";
}
function resetSec(which){
  if(which === "D") $("secDText").value = defaultD();
  if(which === "E") $("secEText").value = defaultE();
}
function recoText(){
  var p = pronouns();
  var n = fullNameCaps() || "____________________";
  return "In view hereof, it is most respectfully recommended unto this Honorable Court that the probation granted to " + n + " be TERMINATED and that said final discharge from probation shall operate to restore to " + p.obj + " all " + p.pos + " civil rights lost or suspended as a result of " + p.pos + " conviction and to totally extinguish " + p.pos + " criminal liability as to the offense for which probation was granted pursuant to Section 16 of Presidential Decree 968 as amended by Republic Act 10707.";
}
function updateRecoPreview(){
  var el = $("recoPreview");
  if(el) el.textContent = recoText();
}

/* ---- live caption + listeners ---- */
function refreshCaption(){
  $("capName").textContent = fullNameCaps() || "—";
  $("capDocket").textContent = val("docketNo") || "—";
  $("capCase").textContent = composeCases() || "—";
}

function initListeners(){
  var dTouched = false, eTouched = false;
  $("secDText").addEventListener("input", function(){ dTouched = true; });
  $("secEText").addEventListener("input", function(){ eTouched = true; });
  document.body.addEventListener("input", function(e){
    var id = e.target.id;
    refreshCaption();
    updateRecoPreview();
    if(["birthday","reportDate"].includes(id)) computeAge();
    if(["courtType","courtBranchNo","courtCity","courtProv"].includes(id)) updateCourtPreview();
    if(["periodYears","periodMonths","periodDays","grantJudgeName","grantCourtType","grantBranchNo","grantCity","grantProv"].includes(id) ||
       (e.target.closest && e.target.closest("#offenseRows, #caseRows"))) updateComposerPreviews();
    if(id === "sex"){
      if(!dTouched) resetSec("D");
      if(!eTouched) resetSec("E");
    }
  });
  document.body.addEventListener("change", function(e){
    if(e.target.id === "sex"){
      if(!dTouched) resetSec("D");
      if(!eTouched) resetSec("E");
      updateRecoPreview();
    }
    if(e.target.id === "courtType") updateCourtPreview();
  });
  var links = [].slice.call(document.querySelectorAll("#sideNav a"));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute("href")); });
  var io = new IntersectionObserver(function(es){
    es.forEach(function(en){
      if(en.isIntersecting){
        links.forEach(function(l){ l.classList.toggle("on", l.getAttribute("href") === "#"+en.target.id); });
      }
    });
  }, {rootMargin:"-30% 0px -60% 0px"});
  secs.forEach(function(s){ if(s) io.observe(s); });
}

/* ---- init ---- */

/* ---- letterhead image slots ---- */
function mediaDataUrl(k){ return "data:" + MEDIA[k].type + ";base64," + MEDIA[k].b64; }
function buildMediaSlots(){
  var grid = $("mediaGrid");
  if(!grid) return;
  grid.innerHTML = "";
  MEDIA_KEYS.forEach(function(k, i){
    var d = document.createElement("div");
    d.className = "mslot";
    d.innerHTML = '<b>' + MEDIA[k].label + '</b>' +
      '<img id="mthumb_' + k + '" alt="' + MEDIA[k].label + '">' +
      '<input type="file" id="mfile_' + k + '" accept="image/*">' +
      '<span class="dim" id="mstat_' + k + '">Using the original image.</span>' +
      '<button type="button" class="btn ghost" style="align-self:flex-start;padding:5px 10px;font-size:12px">↺ Restore original</button>';
    grid.appendChild(d);
    d.querySelector("button").onclick = function(){ resetImage(k); };
    $("mthumb_"+k).src = mediaDataUrl(k);
    $("mfile_"+k).addEventListener("change", function(e){
      var f = e.target.files && e.target.files[0];
      if(!f) return;
      var rd = new FileReader();
      rd.onload = function(){
        var img = new Image();
        img.onload = function(){
          var px = MEDIA[k].px;
          var c = document.createElement("canvas");
          c.width = px[0]; c.height = px[1];
          var ctx = c.getContext("2d");
          var s = Math.min(px[0]/img.width, px[1]/img.height);
          var w = img.width*s, h = img.height*s;
          var fmt = MEDIA_ORIG[k].type;
          if(fmt === "image/jpeg"){ ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0,0,px[0],px[1]); }
          ctx.drawImage(img, (px[0]-w)/2, (px[1]-h)/2, w, h);
          MEDIA[k].b64 = c.toDataURL(fmt, 0.92).split(",")[1];
          MEDIA[k].type = fmt;
          $("mthumb_"+k).src = mediaDataUrl(k);
          $("mstat_"+k).textContent = "Replacement fitted into the original spot at the original size.";
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(f);
    });
  });
}
function resetImage(k){
  MEDIA[k].b64 = MEDIA_ORIG[k].b64;
  MEDIA[k].type = MEDIA_ORIG[k].type;
  $("mthumb_"+k).src = mediaDataUrl(k);
  $("mfile_"+k).value = "";
  $("mstat_"+k).textContent = "Using the original image.";
}

window.addEventListener("DOMContentLoaded", function(){
  $("reportDate").value = todayISO();
  $("secC").value = DEF_C;
  resetSec("D"); resetSec("E");
  bindOther("civilStatus","civilOther");
  addCaseRow("");
  addOffenseRow();
  updateComposerPreviews();
  initOfficerSelect();
  initAutoCaps();
  initFieldGuides();
  buildMediaSlots();
  updateCourtPreview();
  updateRecoPreview();
  refreshCaption();
  initListeners();

  // CSP forbids inline onclick="..." in the packaged build, so these are
  // wired here instead of as HTML attributes (see renderer/public/psir-generator's
  // own app-logic.js for the same convention).
  $("addCaseBtn").addEventListener("click", function(){ addCaseRow(""); });
  $("addOffenseBtn").addEventListener("click", addOffenseRow);
  $("resetSecDBtn").addEventListener("click", function(){ resetSec("D"); });
  $("resetSecEBtn").addEventListener("click", function(){ resetSec("E"); });
  $("genBtn").addEventListener("click", generateDocx);
  $("genBtn2").addEventListener("click", generateDocx);

  window.parent.postMessage({ type: "finalReport:ready" }, "*");
});


/* ================= exact template-fill engine ================= */
function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function b64ToBytes(b){
  var bin = atob(b), out = new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64ToText(b){ return new TextDecoder("utf-8").decode(b64ToBytes(b)); }


function nameProper(){
  var n = [val("firstName"), val("middleName"), val("lastName")].filter(Boolean).join(" ");
  n = smartTitle(n.toLowerCase());
  var a = val("alias");
  return a ? n + " a.k.a. \u201C" + smartTitle(a.toLowerCase()) + "\u201D" : n;
}

function fillTemplate(){
  var p = pronouns();
  var gj = composeGrantJudge();
  var d = b64ToText(TPL_DOC_B64);

  /* expand sections C, D, E with the template's own paragraph formatting */
  function expand(key, items){
    var pat = b64ToText(SEC_PATS[key].pat);
    var sep = b64ToText(SEC_PATS[key].sep);
    return items.map(function(t){ return pat.replace("@@TEXT@@", esc(t)); }).join(sep);
  }
  var secC = $("secC").value.split("\n").map(function(s){return s.trim();}).filter(Boolean);
  var secD = $("secDText").value.split(/\n\s*\n/).map(function(s){return s.replace(/\s+/g," ").trim();}).filter(Boolean);
  var secE = $("secEText").value.split(/\n\s*\n/).map(function(s){return s.replace(/\s+/g," ").trim();}).filter(Boolean);
  d = d.replace("{{SEC_C_BLOCK}}", expand("C", secC.length ? secC : ["None."]));
  d = d.replace("{{SEC_D_BLOCK}}", expand("D", secD.length ? secD : ["None."]));
  d = d.replace("{{SEC_E_BLOCK}}", expand("E", secE.length ? secE : ["None."]));

  var MAP = {
    LETTER_DATE: fmtDate(val("reportDate")) || "__________",
    JUDGE_NAME: (val("judgeName") || "____________________").toUpperCase(),
    JUDGE_TITLE: val("judgePosition") || "Presiding Judge",
    COURT_BRANCH: composeBranch(),
    COURT_LOC: cityOf("courtCity","courtProv") || "__________",
    SALUTATION: val("salutation"),
    ORDER_DATE: fmtDate(val("orderDate")) || "__________",
    RECEIVED_DATE: fmtDate(val("receivedDate")) || "__________",
    OFFICER_FULL: officerFull() || "____________________",
    OFFICER_TITLE: val("officerTitle") || "Supervising Officer",
    NAME_ALIAS: nameWithAlias() || "____________________",
    NAME: fullNameCaps() || "____________________",
    NAME_PROPER: nameProper() || "____________________",
    ALIAS_Q: aliasQuoted() || "Not Applicable",
    CASE_NO: composeCases() || "__________",
    OFFENSE: composeOffenses() || "__________",
    DOCKET: val("docketNo") || "__________",
    GRANT_JUDGE_1: gj[0],
    GRANT_JUDGE_2: gj[1],
    ADDR: val("probAddr") || "__________",
    GRANT_DATE: fmtDate(val("grantDate")) || "__________",
    AGE: val("age") || "____",
    SEX: val("sex"),
    MARITAL: selVal("civilStatus","civilOther") || "__________",
    PERIOD: composePeriod() || "__________",
    SEC_B: val("secB") || "None.",
    CPPO: (val("cppoName") || "____________________").toUpperCase(),
    CPPO_TITLE: val("cppoTitle") || "Chief Probation and Parole Officer",
    REGION: val("brRegion"),
    OFFICE: val("brOffice").toUpperCase(),
    OFFICE_ADDR: val("brAddr"),
    TEL: val("brTel"),
    EMAIL: val("brEmail"),
    WEB: val("brWeb"),
    SIGN_DATE_PLACE: (fmtDate(val("reportDate")) || "__________") + ", " + (val("signPlace") || "__________") + ".",
    OBJ: p.obj,
    POS: p.pos
  };
  Object.keys(MAP).forEach(function(k){
    d = d.split("{{" + k + "}}").join(esc(MAP[k]));
  });
  return d;
}

/* ================= minimal ZIP writer (stored, no compression) ================= */
var CRC_TABLE = (function(){
  var t = new Uint32Array(256);
  for(var n=0;n<256;n++){ var c=n; for(var k=0;k<8;k++) c = (c&1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1); t[n]=c; }
  return t;
})();
function crc32(bytes){
  var c = 0xFFFFFFFF;
  for(var i=0;i<bytes.length;i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c>>>8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function makeZip(files){
  var enc = new TextEncoder();
  var chunks = [], central = [], offset = 0;
  var now = new Date();
  var dosTime = (now.getHours()<<11) | (now.getMinutes()<<5) | (now.getSeconds()>>1);
  var dosDate = ((now.getFullYear()-1980)<<9) | ((now.getMonth()+1)<<5) | now.getDate();
  function u16(v){ return [v&255,(v>>8)&255]; }
  function u32(v){ return [v&255,(v>>8)&255,(v>>16)&255,(v>>24)&255]; }
  files.forEach(function(f){
    var nameB = enc.encode(f.name);
    var data = f.base64 !== undefined ? b64ToBytes(f.base64) : enc.encode(f.text);
    var crc = crc32(data);
    var local = new Uint8Array([].concat(
      u32(0x04034b50), u16(20), u16(0x0800), u16(0),
      u16(dosTime), u16(dosDate),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameB.length), u16(0)
    ));
    chunks.push(local, nameB, data);
    central.push({nameB:nameB, crc:crc, size:data.length, offset:offset});
    offset += local.length + nameB.length + data.length;
  });
  var centralStart = offset, centralSize = 0;
  central.forEach(function(e){
    var hdr = new Uint8Array([].concat(
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0),
      u16(dosTime), u16(dosDate),
      u32(e.crc), u32(e.size), u32(e.size),
      u16(e.nameB.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(e.offset)
    ));
    chunks.push(hdr, e.nameB);
    centralSize += hdr.length + e.nameB.length;
  });
  var eocd = new Uint8Array([].concat(
    u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
    u32(centralSize), u32(centralStart), u16(0)
  ));
  chunks.push(eocd);
  return new Blob(chunks, {type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
}

/* ================= generate & download ================= */
function setMsg(text, err){
  ["genMsg","genMsg2"].forEach(function(id){
    var el = $(id);
    if(el){ el.textContent = text; el.className = "msg" + (err ? " err" : ""); }
  });
}
async function generateDocx(){
  var btn = $("genBtn"), btn2 = $("genBtn2");
  if(btn) btn.disabled = true;
  if(btn2) btn2.disabled = true;
  setMsg("Filling in the Final Report template\u2026", false);
  try{
    var mediaByName = {};
    Object.keys(MEDIA_FILES).forEach(function(k){ mediaByName[MEDIA_FILES[k]] = k; });
    var files = TPL_PARTS.map(function(part){
      var mk = mediaByName[part.name];
      return {name: part.name, base64: mk ? MEDIA[mk].b64 : part.b64};
    });
    files.push({name: "word/document.xml", text: fillTemplate()});

    var blob = makeZip(files);
    var nm = (fullNameCaps().replace(/[^A-Z0-9 ]/g,"").trim().replace(/\s+/g,"_") || "PROBATIONER");
    var fname = "FINAL_REPORT_" + nm + ".docx";
    var buf = await blob.arrayBuffer();
    var base64 = u8ToB64(new Uint8Array(buf));
    window.parent.postMessage({ type: "finalReport:generated", payload: { base64: base64, filename: fname, snapshot: collectSnapshot() } }, "*");
    setMsg("Done \u2014 " + fname + " generated. Saving\u2026", false);
  }catch(e){
    console.error(e);
    setMsg("Error: " + e.message, true);
  }finally{
    if(btn) btn.disabled = false;
    if(btn2) btn2.disabled = false;
  }
}

/* ================= HOST BRIDGE (Electron app integration) =================
   The React app hosts this generator inside an <iframe>. It prefills the
   form from the probationer's saved Final Report profile + office defaults
   (see renderer/src/components/GenerateFinalReportModal.jsx), and receives
   the generated .docx (as base64) plus a full field snapshot to persist
   back to the probationer's record instead of triggering a browser
   download \u2014 mirrors renderer/public/psir-generator/app-logic.js's own
   HOST BRIDGE section. */

function u8ToB64(u8){
  var binary = "";
  var chunk = 0x8000;
  for(var i=0;i<u8.length;i+=chunk){
    binary += String.fromCharCode.apply(null, u8.subarray(i, i+chunk));
  }
  return btoa(binary);
}

function collectSnapshot(){
  var fields = {};
  document.querySelectorAll("main input[id], main select[id], main textarea[id]").forEach(function(el){
    if(el.type === "file") return;
    fields[el.id] = el.value;
  });
  var cases = [].slice.call(document.querySelectorAll("#caseRows .caseInput")).map(function(i){ return i.value; });
  var offenses = [].slice.call(document.querySelectorAll("#offenseRows .drow")).map(function(d){
    return {
      mode: d.querySelector(".offMode").value,
      secs: d.querySelector(".offSecs").value,
      art: d.querySelector(".offArt").value,
      ra: d.querySelector(".offRA").value,
      custom: d.querySelector(".offCustom").value
    };
  });
  var media = {};
  MEDIA_KEYS.forEach(function(k){
    if(MEDIA[k].b64 !== MEDIA_ORIG[k].b64) media[k] = {b64: MEDIA[k].b64, type: MEDIA[k].type};
  });
  return {fields: fields, cases: cases, offenses: offenses, media: media};
}

function applyPrefill(p){
  if(!p) return;
  Object.keys(p.fields || {}).forEach(function(id){
    var el = $(id);
    if(!el) return;
    el.value = p.fields[id] != null ? p.fields[id] : "";
    el.dispatchEvent(new Event("input", {bubbles:true}));
    el.dispatchEvent(new Event("change", {bubbles:true}));
  });
  if(Array.isArray(p.cases) && p.cases.length){
    $("caseRows").innerHTML = "";
    p.cases.forEach(function(v){ addCaseRow(v); });
  }
  if(Array.isArray(p.offenses) && p.offenses.length){
    $("offenseRows").innerHTML = "";
    p.offenses.forEach(function(o){
      addOffenseRow();
      var rows = document.querySelectorAll("#offenseRows .drow");
      var d = rows[rows.length - 1];
      d.querySelector(".offMode").value = o.mode || "ra";
      d.querySelector(".offSecs").value = o.secs || "";
      d.querySelector(".offArt").value = o.art || "";
      d.querySelector(".offRA").value = o.ra || "";
      d.querySelector(".offCustom").value = o.custom || "";
      d.querySelector(".offMode").dispatchEvent(new Event("change", {bubbles:true}));
    });
  }
  if(p.media){
    Object.keys(p.media).forEach(function(k){
      if(!MEDIA[k]) return;
      MEDIA[k].b64 = p.media[k].b64;
      MEDIA[k].type = p.media[k].type;
      var thumb = $("mthumb_"+k);
      if(thumb) thumb.src = mediaDataUrl(k);
      var stat = $("mstat_"+k);
      if(stat) stat.textContent = "\u2713 Loaded from saved profile.";
    });
  }
  updateComposerPreviews();
  updateCourtPreview();
  updateRecoPreview();
  refreshCaption();
  computeAge();
}

window.addEventListener("message", function(ev){
  var msg = ev.data;
  if(!msg || typeof msg !== "object") return;
  if(msg.type === "finalReport:prefill"){
    applyPrefill(msg.payload || {});
  } else if(msg.type === "finalReport:requestSnapshot"){
    window.parent.postMessage({ type: "finalReport:snapshot", payload: collectSnapshot() }, "*");
  }
});
