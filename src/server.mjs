// server.mjs — a tiny browser chat UI for the CRMA Copilot.
// ---------------------------------------------------------------------------
// Zero extra dependencies (Node core http only). Serves a chat page at
//   http://localhost:4111  and a POST /chat endpoint that runs the SAME
// `copilot` agent used by the terminal runner. This sidesteps the version
// churn in `mastra dev` while giving you a real Chrome UI to demo.
//
// Conversation history is kept per browser session in memory (single-user dev
// tool). Restart the server to clear it.
// ---------------------------------------------------------------------------

import http from "node:http";
import { copilot } from "./mastra/agents/copilot.mjs";
import { ACTIVE_PROVIDER } from "./mastra/models.mjs";
import { TARGET_ORG, DRY_RUN } from "./mastra/sf.mjs";

const PORT = Number(process.env.UI_PORT || 4111);

// One shared conversation (single-user local demo tool).
const messages = [];

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>CRMA Copilot</title>
<style>
  :root { --bg:#0b1220; --panel:#111a2e; --user:#1f6feb; --bot:#1b2740; --line:#243352; --text:#e6edf7; --muted:#8fa3c4; }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text); }
  header { padding:12px 18px; background:var(--panel); border-bottom:1px solid var(--line); display:flex; gap:16px; align-items:center; }
  header h1 { font-size:15px; margin:0; }
  header .tag { font-size:12px; color:var(--muted); }
  header .tag b { color:var(--text); }
  header .deploy { margin-left:auto; font-size:12px; padding:3px 10px; border-radius:12px; }
  .safe { background:#123d24; color:#7ee2a8; } .live { background:#5a1620; color:#ff9aa8; }
  #log { max-width:900px; margin:0 auto; padding:20px 16px 140px; }
  .msg { margin:12px 0; display:flex; }
  .msg.user { justify-content:flex-end; }
  .bubble { max-width:80%; padding:10px 14px; border-radius:12px; white-space:pre-wrap; word-wrap:break-word; }
  .user .bubble { background:var(--user); color:#fff; border-bottom-right-radius:3px; }
  .bot .bubble { background:var(--bot); border:1px solid var(--line); border-bottom-left-radius:3px; }
  .bot .bubble table { border-collapse:collapse; margin:8px 0; font-size:13px; }
  .bot .bubble th, .bot .bubble td { border:1px solid var(--line); padding:5px 9px; text-align:left; }
  .bot .bubble th { background:#22304e; }
  .bot .bubble code { background:#0c1526; padding:1px 5px; border-radius:4px; }
  .bot .bubble pre { background:#0c1526; padding:10px; border-radius:8px; overflow:auto; }
  .thinking { color:var(--muted); font-style:italic; }
  footer { position:fixed; bottom:0; left:0; right:0; background:var(--panel); border-top:1px solid var(--line); padding:12px; }
  .composer { max-width:900px; margin:0 auto; display:flex; gap:8px; }
  textarea { flex:1; background:#0c1526; color:var(--text); border:1px solid var(--line); border-radius:8px; padding:10px; resize:none; min-height:46px; max-height:160px; font:inherit; }
  button { background:var(--user); color:#fff; border:0; border-radius:8px; padding:0 20px; font-weight:600; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
</style></head>
<body>
<header>
  <h1>CRMA Copilot</h1>
  <span class="tag">provider <b id="prov">—</b> · org <b id="org">—</b></span>
  <span class="deploy" id="deploy">—</span>
</header>
<div id="log"></div>
<footer><div class="composer">
  <textarea id="in" placeholder="Ask me to get / explain / edit / debug / create / deploy a recipe or dashboard…"></textarea>
  <button id="send">Send</button>
</div></footer>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script>
  const log = document.getElementById('log'), input = document.getElementById('in'), send = document.getElementById('send');
  fetch('/meta').then(r=>r.json()).then(m=>{
    document.getElementById('prov').textContent=m.provider;
    document.getElementById('org').textContent=m.org||'—';
    const d=document.getElementById('deploy');
    d.textContent = m.dryRun ? 'DEPLOY: DRY-RUN (safe)' : 'DEPLOY: LIVE WRITE';
    d.className = 'deploy ' + (m.dryRun ? 'safe':'live');
  });
  function add(role, text){
    const wrap=document.createElement('div'); wrap.className='msg '+role;
    const b=document.createElement('div'); b.className='bubble';
    if(role==='bot' && window.marked){ b.innerHTML=marked.parse(text); } else { b.textContent=text; }
    wrap.appendChild(b); log.appendChild(wrap); window.scrollTo(0,document.body.scrollHeight);
    return b;
  }
  async function submit(){
    const q=input.value.trim(); if(!q) return;
    input.value=''; add('user', q);
    send.disabled=true;
    const thinking=add('bot','…thinking'); thinking.classList.add('thinking');
    try{
      const res=await fetch('/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:q})});
      const data=await res.json();
      thinking.remove();
      add('bot', data.ok ? data.text : ('⚠️ '+data.error));
    }catch(e){ thinking.remove(); add('bot','⚠️ '+e.message); }
    send.disabled=false; input.focus();
  }
  send.onclick=submit;
  input.addEventListener('keydown',e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); submit(); }});
  input.focus();
</script>
</body></html>`;

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(PAGE);
  }
  if (req.method === "GET" && req.url === "/meta") {
    return json(res, 200, { provider: ACTIVE_PROVIDER, org: TARGET_ORG, dryRun: DRY_RUN });
  }
  if (req.method === "POST" && req.url === "/chat") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { message } = JSON.parse(body || "{}");
        if (!message) return json(res, 400, { ok: false, error: "empty message" });
        messages.push({ role: "user", content: message });
        const out = await copilot.generate(messages, { maxSteps: 50, temperature: 1 });
        messages.push({ role: "assistant", content: out.text });
        return json(res, 200, { ok: true, text: out.text });
      } catch (e) {
        return json(res, 500, { ok: false, error: e.message || String(e) });
      }
    });
    return;
  }
  json(res, 404, { ok: false, error: "not found" });
});

server.listen(PORT, () => {
  console.log("");
  console.log("  ┌───────────────────────────────────────────────┐");
  console.log("  │  CRMA Copilot — browser UI                       │");
  console.log(`  │  provider: ${ACTIVE_PROVIDER.padEnd(9)} org: ${(TARGET_ORG || "—").padEnd(16)}│`);
  console.log(`  │  deploy:   ${(DRY_RUN ? "DRY-RUN (safe)" : "LIVE WRITE").padEnd(35)}│`);
  console.log("  ├───────────────────────────────────────────────┤");
  console.log(`  │  Open  →  http://localhost:${PORT}                  │`);
  console.log("  └───────────────────────────────────────────────┘");
  console.log("");
});
