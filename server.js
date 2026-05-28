/* ============================================================
 *  Petition "Protegeons Nos Enfants" — API backend
 *  Node.js + Express + PostgreSQL (Railway)
 *
 *  Routes :
 *    GET  /api/state       -> { count, signers: [...] }
 *    POST /api/sign        -> body { name, city }   (nominative)
 *    POST /api/sign-anon   -> (aucun body requis)    (anonyme)
 *
 *  Reponses :
 *    200 { count, signers }   succes
 *    400 { error:'name_required' }
 *    429 { error:'limit_reached' }   (plus de 3 signatures pour cette IP)
 *    500 { error:'db_error' }
 *
 *  Variables d'environnement :
 *    DATABASE_URL   (fournie par Railway via le plugin Postgres)
 *    BASE_OFFSET    (optionnel, defaut 1854 : base de depart)
 *    AUTO_START     (optionnel, ISO date : point de depart du +10 auto)
 *    AUTO_PER_TICK  (optionnel, defaut 10)
 *    AUTO_TICK_SEC  (optionnel, defaut 10 : periode en secondes)
 *    MAX_PER_IP     (optionnel, defaut 3)
 *    PORT           (fournie par Railway)
 * ============================================================ */

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.set('trust proxy', true); // IP reelle derriere le proxy Railway

/* ---- Connexion PostgreSQL ---- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

/* ---- Parametres ---- */
const BASE_OFFSET   = parseInt(process.env.BASE_OFFSET   || '1854', 10);
const AUTO_PER_TICK = parseInt(process.env.AUTO_PER_TICK || '10',  10);
const AUTO_TICK_SEC = parseInt(process.env.AUTO_TICK_SEC || '10',  10);
const MAX_PER_IP    = parseInt(process.env.MAX_PER_IP    || '3',   10);
// Point de depart du compteur automatique : par defaut, le demarrage du serveur.
const AUTO_START = process.env.AUTO_START ? new Date(process.env.AUTO_START) : new Date();

/* ---- Middlewares ---- */
app.use(cors());
app.use(express.json());

/* ---- Init base ---- */
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS signatures (
      id          BIGSERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      city        TEXT DEFAULT '',
      is_anon     BOOLEAN NOT NULL DEFAULT FALSE,
      ip          TEXT DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Ajoute la colonne ip si une ancienne table existe deja sans elle
  await pool.query(`ALTER TABLE signatures ADD COLUMN IF NOT EXISTS ip TEXT DEFAULT '';`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_signatures_created_at ON signatures (created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_signatures_ip ON signatures (ip);`);
  console.log('Base de donnees prete.');
}

/* ---- Compteur automatique partage (+10 toutes les 10s) ---- */
function autoCount() {
  const elapsedSec = (Date.now() - AUTO_START.getTime()) / 1000;
  if (elapsedSec <= 0) return 0;
  return Math.floor(elapsedSec / AUTO_TICK_SEC) * AUTO_PER_TICK;
}

/* ---- IP du client ---- */
function clientIp(req) {
  // Railway place l'IP reelle dans x-forwarded-for ; trust proxy resout req.ip
  return (req.ip || '').toString();
}

/* ---- Etat global ---- */
async function getState() {
  const countRes = await pool.query('SELECT COUNT(*)::int AS c FROM signatures');
  const realCount = countRes.rows[0].c;

  const signersRes = await pool.query(
    `SELECT name, city, is_anon, created_at
       FROM signatures
       ORDER BY created_at DESC
       LIMIT 8`
  );
  const signers = signersRes.rows.map(r => ({
    name: r.name,
    city: r.city || '',
    isAnon: r.is_anon,
    createdAt: r.created_at
  }));

  return { count: BASE_OFFSET + realCount + autoCount(), signers };
}

/* ---- Verifie la limite par IP ---- */
async function ipLimitReached(ip) {
  if (!ip) return false; // si on ne peut pas lire l'IP, on ne bloque pas
  const res = await pool.query('SELECT COUNT(*)::int AS c FROM signatures WHERE ip = $1', [ip]);
  return res.rows[0].c >= MAX_PER_IP;
}

/* ---- Routes ---- */
app.get('/api/state', async (req, res) => {
  try {
    res.json(await getState());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/sign', async (req, res) => {
  try {
    let { name, city } = req.body || {};
    name = (name || '').toString().trim().slice(0, 60);
    city = (city || '').toString().trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'name_required' });

    const ip = clientIp(req);
    if (await ipLimitReached(ip)) {
      return res.status(429).json({ error: 'limit_reached' });
    }

    await pool.query(
      'INSERT INTO signatures (name, city, is_anon, ip) VALUES ($1, $2, FALSE, $3)',
      [name, city, ip]
    );
    res.json(await getState());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/sign-anon', async (req, res) => {
  try {
    const ip = clientIp(req);
    if (await ipLimitReached(ip)) {
      return res.status(429).json({ error: 'limit_reached' });
    }

    await pool.query(
      "INSERT INTO signatures (name, city, is_anon, ip) VALUES ('Citoyen Anonyme', 'Cameroun', TRUE, $1)",
      [ip]
    );
    res.json(await getState());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.get('/', (req, res) => res.send('Petition API OK'));

/* ---- Demarrage ---- */
const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log('API en ecoute sur le port ' + PORT)))
  .catch(err => { console.error('Echec init DB :', err); process.exit(1); });
