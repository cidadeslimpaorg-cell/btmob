const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const UPLOADS = path.join(ROOT, 'uploads');
const BUILDS = path.join(ROOT, 'builds');
const DATA = path.join(ROOT, 'data');
const JOBS_FILE = path.join(DATA, 'jobs.json');
const CONFIG_FILE = path.join(DATA, 'config.json');
for (const dir of [UPLOADS, BUILDS, DATA]) fs.mkdirSync(dir, { recursive: true });

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) { return null; }
}
function writeConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}
function isInstalled() { return !!readConfig()?.installed; }
function configuredCredentials() {
  const cfg = readConfig();
  return {
    user: cfg?.admin_user || process.env.ADMIN_USER || 'admin',
    pass: cfg?.admin_pass || process.env.ADMIN_PASS || '123456'
  };
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/install', (_req, res) => {
  if (isInstalled()) return res.redirect('/');
  res.sendFile(path.join(ROOT, 'public', 'install.html'));
});
app.get('/api/install/status', (_req, res) => res.json({ installed: isInstalled() }));
app.post('/api/install', (req, res) => {
  if (isInstalled()) return res.status(409).json({ success: false, error: 'O sistema já está instalado.' });
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const confirm = String(req.body?.confirm || '');
  if (!username || username.length < 3) return res.status(400).json({ success:false, error:'Informe um usuário com pelo menos 3 caracteres.' });
  if (password.length < 6) return res.status(400).json({ success:false, error:'A senha deve ter pelo menos 6 caracteres.' });
  if (password !== confirm) return res.status(400).json({ success:false, error:'As senhas não coincidem.' });
  writeConfig({ installed: true, installed_at: new Date().toISOString(), admin_user: username, admin_pass: password });
  res.json({ success: true });
});

app.use(express.static(path.join(ROOT, 'public')));

let jobs = {};
try { jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8')); } catch (_) { jobs = {}; }
const saveJobs = async () => {
  const tmp = JOBS_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(jobs, null, 2));
  await fsp.rename(tmp, JOBS_FILE);
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, file, cb) => cb(null, crypto.randomUUID() + '.upload')
});
const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 500) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.apk') return cb(new Error('Selecione apenas arquivos .apk'));
    cb(null, true);
  }
});

app.post('/login', (req, res) => {
  if (!isInstalled() && !process.env.ADMIN_USER) return res.status(503).json({ success:false, error:'Instale o sistema primeiro em /install' });
  const { username, password } = req.body || {};
  const creds = configuredCredentials();
  if (username === creds.user && password === creds.pass) {
    return res.json({ success: true, role: 'admin' });
  }
  res.status(401).json({ success: false, error: 'Usuário ou senha inválidos' });
});

async function processJob(id) {
  try {
    jobs[id].status = 'Validando pacote APK'; jobs[id].progress = 20; await saveJobs();
    await new Promise(r => setTimeout(r, 700));
    jobs[id].status = 'Preparando arquivo de saída'; jobs[id].progress = 50; await saveJobs();
    await new Promise(r => setTimeout(r, 700));
    const dst = path.join(BUILDS, id + '.apk');
    await fsp.copyFile(jobs[id].input, dst);
    jobs[id].output = dst;
    jobs[id].status = 'Processamento concluído'; jobs[id].progress = 100; jobs[id].done = true;
    await saveJobs();
  } catch (err) {
    jobs[id].status = 'Erro no processamento'; jobs[id].error = true; jobs[id].done = false;
    await saveJobs();
  }
}

app.post('/upload', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'icon', maxCount: 1 }]), async (req, res) => {
  if (!isInstalled() && !process.env.ADMIN_USER) return res.status(503).json({ error:'Instale o sistema primeiro em /install' });
  const file = req.files?.file?.[0];
  const icon = req.files?.icon?.[0];
  const appName = String(req.body?.app_name || '').trim();
  if (!file) return res.status(400).json({ error: 'Arquivo APK obrigatório' });
  if (!appName) { await fsp.unlink(file.path).catch(() => {}); return res.status(400).json({ error: 'Digite o nome do app' }); }
  const id = crypto.randomUUID().replaceAll('-', '');
  const input = path.join(UPLOADS, id + '.apk');
  await fsp.rename(file.path, input);
  if (icon) await fsp.rename(icon.path, path.join(UPLOADS, id + '_icon' + path.extname(icon.originalname)));
  jobs[id] = { input, output: null, app_name: appName, progress: 5, status: 'Iniciando processamento', done: false, created_at: new Date().toISOString() };
  await saveJobs();
  processJob(id);
  res.json({ build_id: id });
});

app.get('/status/:id', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: true, status: 'Build não encontrado' });
  res.json({ progress: job.progress, status: job.status, done: job.done, error: !!job.error });
});

app.get('/download/:id', (req, res) => {
  const job = jobs[req.params.id];
  if (!job?.done || !job.output || !fs.existsSync(job.output)) return res.status(404).send('Build ainda não está pronto');
  const safe = job.app_name.replace(/[^a-zA-Z0-9 ._-]/g, '_').trim() || 'app';
  res.download(job.output, safe + '.apk', { headers: { 'Content-Type': 'application/vnd.android.package-archive' } });
});

app.use((req, res, next) => {
  if (req.method === 'GET' && !isInstalled() && !req.path.startsWith('/download/')) return res.redirect('/install');
  if (req.method === 'GET' && !req.path.startsWith('/download/')) return res.sendFile(path.join(ROOT, 'public', 'index.html'));
  next();
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Erro na requisição' });
});

app.listen(PORT, HOST, () => console.log(`BTMOB rodando em http://${HOST}:${PORT}`));
