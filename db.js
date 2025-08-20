// db.js
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Pool with SSL auto-detect
// ---------------------------------------------------------------------------
const isLocal =
  process.env.DATABASE_URL?.includes("localhost") ||
  process.env.DATABASE_URL?.includes("127.0.0.1");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false }, // ✅ Use SSL only in cloud (Render/Heroku)
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
async function ensureSchema() {
  const schemaPath = path.join(process.cwd(), "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  console.log("📦 Ensuring schema...");
  await pool.query(sql);
  console.log("✅ Schema ready");
}

// ---------------------------------------------------------------------------
// Game Rules
// ---------------------------------------------------------------------------
async function getRules() {
  const { rows } = await pool.query(
    "select * from game_rules order by id desc limit 1"
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Bets
// ---------------------------------------------------------------------------
async function recordBet(b) {
  await pool.query(
    `insert into bets(
       player, bet_amount_lamports, bet_type, target, roll, payout_lamports,
       nonce, expiry_unix, signature_base58, status, game
     )
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      b.player,
      BigInt(b.amount),
      Number(b.betType),
      Number(b.target),
      Number(b.roll || 0),
      BigInt(b.payout || 0),
      BigInt(b.nonce),
      BigInt(b.expiry),
      b.signature_base58 || "",
      b.status || "prepared_lock",
      b.game || "dice", // ✅ default if not passed
    ]
  );
}


async function getBetByNonce(nonce) {
  const { rows } = await pool.query(
    `select * from bets where nonce = $1 order by id desc limit 1`,
    [BigInt(nonce)]
  );
  return rows[0] || null;
}

async function updateBetPrepared({ nonce, roll, payout }) {
  await pool.query(
    `update bets
       set roll = $2,
           payout_lamports = $3,
           status = 'prepared_resolve'
     where nonce = $1`,
    [BigInt(nonce), Number(roll), BigInt(payout)]
  );
}

// ---------------------------------------------------------------------------
// Dashboard Helpers
// ---------------------------------------------------------------------------
async function getTotalUsers() {
  const { rows } = await pool.query(
    "select count(distinct player) as total from bets"
  );
  return Number(rows[0].total);
}

async function getActiveGames() {
  const { rows } = await pool.query(
    "select count(*) as total from bets where created_at > now() - interval '1 day'"
  );
  return Number(rows[0].total);
}

async function getTotalVolume() {
  const { rows } = await pool.query(
    "select coalesce(sum(bet_amount_lamports),0) as total from bets"
  );
  return Number(rows[0].total);
}

async function getDailyRevenue() {
  const { rows } = await pool.query(
    "select coalesce(sum(bet_amount_lamports - payout_lamports),0) as revenue from bets where created_at > now() - interval '1 day'"
  );
  return Number(rows[0].revenue);
}

async function getRecentActivity(limit = 5) {
  const { rows } = await pool.query(
    "select player, bet_amount_lamports, payout_lamports, bet_type, created_at from bets order by id desc limit $1",
    [limit]
  );
  return rows.map((r) => ({
    user: r.player,
    game: r.game,
    action: r.payout_lamports > 0 ? "Won Game" : "Lost Game",
    amount: `${r.payout_lamports > 0 ? "+" : "-"}${(
      Math.abs(Number(r.payout_lamports)) / 1e9
    ).toFixed(4)} SOL`,
    time: new Date(r.created_at).toLocaleTimeString(),
  }));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  pool,
  ensureSchema,
  getRules,
  recordBet,
  getBetByNonce,
  updateBetPrepared,
  // Dashboard
  getTotalUsers,
  getActiveGames,
  getTotalVolume,
  getDailyRevenue,
  getRecentActivity,
};
