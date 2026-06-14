'use strict';

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const PROGRESS_FILE = path.join(__dirname, 'progress.json');

// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_W = 480, CANVAS_H = 270;
const ARENA_X = 8, ARENA_Y = 8;
const ARENA_W = CANVAS_W - 16, ARENA_H = CANVAS_H - 16;
const TICK_MS = 20;

const ADMIN_PASSWORD = '67892155';
const ADMIN_XP = 1000000000000000000; // 1e18 — unlocks everything
function isAdminPw(pw) { return pw === ADMIN_PASSWORD; }

const PARRY_WINDOW   = 350;   // ms the parry is "active" and reflects
const PARRY_COOLDOWN = 5000;  // ms before it can be used again
const PARRY_REFLECT  = 1.5;   // reflected damage multiplier

const WEAPONS = [
  { id: 'sword',      name: 'SWORD',      damage: 20, range: 42,  atkSpd: 400,  type: 'melee',  unlockXp: 0,    special: { kind: 'slam',    dmg: 45, range: 62,  cd: 5000 } },
  { id: 'dagger',     name: 'DAGGER',     damage: 10, range: 34,  atkSpd: 180,  type: 'melee',  unlockXp: 0,    special: { kind: 'slam',    dmg: 28, range: 46,  cd: 3500 } },
  { id: 'axe',        name: 'AXE',        damage: 38, range: 42,  atkSpd: 700,  type: 'melee',  unlockXp: 150,  special: { kind: 'slam',    dmg: 75, range: 58,  cd: 7000 } },
  { id: 'spear',      name: 'SPEAR',      damage: 18, range: 68,  atkSpd: 500,  type: 'melee',  unlockXp: 300,  special: { kind: 'pierce',  dmg: 45, range: 150, cd: 5000 } },
  { id: 'bow',        name: 'BOW',        damage: 15, range: 200, atkSpd: 600,  type: 'ranged', unlockXp: 500,  special: { kind: 'spread',  dmg: 22, range: 200, cd: 6000, count: 3 } },
  { id: 'staff',      name: 'STAFF',      damage: 25, range: 180, atkSpd: 900,  type: 'ranged', unlockXp: 800,  aoeRadius: 28, special: { kind: 'aoeshot', dmg: 140, range: 220, cd: 8000, aoe: 70 } },
  { id: 'hammer',     name: 'HAMMER',     damage: 50, range: 44,  atkSpd: 1000, type: 'melee',  unlockXp: 1200, special: { kind: 'slam',    dmg: 95, range: 74,  cd: 9000 } },
  { id: 'wand',       name: 'WAND',       damage: 8,  range: 150, atkSpd: 250,  type: 'ranged', unlockXp: 1700, special: { kind: 'spread',  dmg: 14, range: 170, cd: 4500, count: 5 } },
  { id: 'crossbow',   name: 'CROSSBOW',   damage: 30, range: 220, atkSpd: 800,  type: 'ranged', unlockXp: 2400, pierce: true, special: { kind: 'pierce',  dmg: 60, range: 250, cd: 7000 } },
  { id: 'flail',      name: 'FLAIL',      damage: 22, range: 50,  atkSpd: 500,  type: 'melee',  unlockXp: 3200, swing360: true, special: { kind: 'slam', dmg: 50, range: 68, cd: 6000 } },
  { id: 'greatsword', name: 'GREATSWORD', damage: 45, range: 70,  atkSpd: 850,  type: 'melee',  unlockXp: 4500, special: { kind: 'slam',    dmg: 85, range: 80,  cd: 8000 } },
];

const WEAPON_COLORS = {
  sword: '#c8d8e8', dagger: '#d4e8b0', axe: '#e8a040', spear: '#c0c8d0',
  bow: '#b89060', staff: '#cc66ff', hammer: '#aab0b8', wand: '#88ddff',
  crossbow: '#cc8844', flail: '#dd4444', greatsword: '#ddeeff',
};

const WAVE_CONFIG = [
  { monsters: 3, hpMult: 1.0, speedMult: 1.0  },
  { monsters: 5, hpMult: 1.1, speedMult: 1.05 },
  { monsters: 7, hpMult: 1.2, speedMult: 1.1  },
  { monsters: 8, hpMult: 1.4, speedMult: 1.15 },
];

// ─── Progress Persistence ─────────────────────────────────────────────────────

function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); }
  catch { return { players: {}, leaderboard: [] }; }
}

function saveProgress(data) {
  try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2)); } catch {}
}

function getPlayerXp(password) {
  if (!password) return 0;
  return loadProgress().players[password] || 0;
}

function setPlayerXp(password, xp) {
  if (!password) return;
  const data = loadProgress();
  data.players[password] = xp;
  saveProgress(data);
}

function addLeaderboardEntry(name, waves) {
  const data = loadProgress();
  if (!data.leaderboard) data.leaderboard = [];
  data.leaderboard.push({ name, waves, date: new Date().toISOString().split('T')[0] });
  data.leaderboard.sort((a, b) => b.waves - a.waves);
  data.leaderboard = data.leaderboard.slice(0, 10);
  saveProgress(data);
  return data.leaderboard;
}

function getLeaderboard() {
  return loadProgress().leaderboard || [];
}

function getPlayerSkin(password) {
  if (!password) return { colorIdx: 0, hatIdx: 0 };
  return loadProgress().skins?.[password] || { colorIdx: 0, hatIdx: 0 };
}

function setPlayerSkin(password, skin) {
  if (!password) return;
  const data = loadProgress();
  if (!data.skins) data.skins = {};
  data.skins[password] = {
    colorIdx: Math.max(0, Math.min(7, Number(skin.colorIdx) || 0)),
    hatIdx:   Math.max(0, Math.min(4, Number(skin.hatIdx)   || 0)),
  };
  saveProgress(data);
}

function getUnlockedWeaponIds(xp) {
  return WEAPONS.filter(w => w.unlockXp <= xp).map(w => w.id);
}

// Order a weapon-id list by their position in WEAPONS (stable, canonical order)
function sortWeaponIds(ids) {
  const valid = ids.filter(id => WEAPONS.some(w => w.id === id));
  return Array.from(new Set(valid)).sort(
    (a, b) => WEAPONS.findIndex(w => w.id === a) - WEAPONS.findIndex(w => w.id === b)
  );
}

function getStoredWeapons(password) {
  if (!password) return [];
  return sortWeaponIds(loadProgress().weapons?.[password] || []);
}

function saveStoredWeapons(password, ids) {
  if (!password) return;
  const data = loadProgress();
  if (!data.weapons) data.weapons = {};
  data.weapons[password] = sortWeaponIds(ids);
  saveProgress(data);
}

function checkNewUnlocks(oldXp, newXp) {
  const was = getUnlockedWeaponIds(oldXp);
  return getUnlockedWeaponIds(newXp).filter(id => !was.includes(id));
}

// ─── Room State ───────────────────────────────────────────────────────────────

function makePlayer(num, xp) {
  return {
    num,
    x: num === 1 ? 80 : 388,
    y: 135,
    w: 12, h: 16,
    speed: 3.0,
    hp: 100, maxHp: 100,
    lives: 3,
    facing: num === 1 ? 1 : -1,
    weaponIdx: 0,
    unlockedWeapons: getUnlockedWeaponIds(xp),
    atkCooldown: 0,
    specialCooldown: 0,
    parryCooldown: 0,
    parryTimer: 0,
    swingTimer: 0,
    invincible: 0,
    hitFlash: 0,
    dead: false,
    respawnTimer: 0,
    skin: { colorIdx: 0, hatIdx: 0 },
  };
}

const room = {
  p1: null, p2: null,
  gameState: 'LOBBY',
  gameMode: 'pvp',
  playerNames: { p1: 'PLAYER 1', p2: 'PLAYER 2' },
  passwords: { p1: '', p2: '' },
  playerXp: { p1: 0, p2: 0 },
  playerSkins: { p1: null, p2: null },
  playerUnlocks: { p1: null, p2: null },
  p1Joined: false, p2Joined: false,
  players: { p1: null, p2: null },
  inputs: {
    p1: { up: false, down: false, left: false, right: false, attack: false, swap: false, special: false, parry: false },
    p2: { up: false, down: false, left: false, right: false, attack: false, swap: false, special: false, parry: false },
  },
  monsters: [],
  projectiles: [],
  particles: [],
  wave: { num: 0, monstersLeft: 0, spawnQueue: 0, spawnTimer: 0, betweenTimer: 0 },
  waveHpMult: 1,
  waveSpeedMult: 1,
  unlockQueues: { p1: [], p2: [] },
  round: { p1Wins: 0, p2Wins: 0, maxWins: 3 },
  roundOverTimer: 0,
  lastLeaderboard: [],
  attackJustPressed: { p1: false, p2: false },
  swapJustPressed: { p1: false, p2: false },
  specialJustPressed: { p1: false, p2: false },
  parryJustPressed: { p1: false, p2: false },
  prevInputs: {
    p1: { attack: false, swap: false, special: false, parry: false },
    p2: { attack: false, swap: false, special: false, parry: false },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x
      && a.y < b.y + b.h && a.y + a.h > b.y;
}

function weapon(p) {
  return WEAPONS.find(w => w.id === p.unlockedWeapons[p.weaponIdx]) || WEAPONS[0];
}

function playerKeyOf(t) {
  return t === room.players.p1 ? 'p1' : t === room.players.p2 ? 'p2' : null;
}

function spawnParrySpark(x, y) {
  room.particles.push({ type: 'parry', x, y, timer: 320, max: 320 });
}

function broadcast(msg) {
  const str = JSON.stringify(msg);
  if (room.p1 && room.p1.readyState === 1) room.p1.send(str);
  if (room.p2 && room.p2.readyState === 1) room.p2.send(str);
}

function spawnMonster() {
  const edge = Math.floor(Math.random() * 4);
  let mx, my;
  if (edge === 0)      { mx = ARENA_X + Math.random() * ARENA_W; my = ARENA_Y + 4; }
  else if (edge === 1) { mx = ARENA_X + Math.random() * ARENA_W; my = ARENA_Y + ARENA_H - 16; }
  else if (edge === 2) { mx = ARENA_X + 4;                        my = ARENA_Y + Math.random() * ARENA_H; }
  else                 { mx = ARENA_X + ARENA_W - 14;             my = ARENA_Y + Math.random() * ARENA_H; }

  const hp = Math.round(30 * room.waveHpMult);
  room.monsters.push({
    id: Math.random().toString(36).slice(2),
    x: mx, y: my, w: 10, h: 12,
    hp, maxHp: hp,
    speed: 0.55 * room.waveSpeedMult,
    atkCooldown: 0,
    atkRange: 12,
    atkDamage: 8,
    hitFlash: 0,
    invincible: 0,
  });
}

function startWave(num) {
  let cfg;
  if (room.gameMode === 'waves' && num > WAVE_CONFIG.length) {
    const extra = num - WAVE_CONFIG.length;
    const base  = WAVE_CONFIG[WAVE_CONFIG.length - 1];
    cfg = {
      monsters:   Math.min(base.monsters + Math.floor(extra * 0.6), 24),
      hpMult:     base.hpMult    * (1 + extra * 0.15),
      speedMult:  Math.min(base.speedMult * (1 + extra * 0.04), 2.8),
    };
  } else {
    cfg = WAVE_CONFIG[Math.min(num - 1, WAVE_CONFIG.length - 1)];
  }
  room.wave = { num, monstersLeft: cfg.monsters, spawnQueue: cfg.monsters, spawnTimer: 500, betweenTimer: 0 };
  room.waveHpMult   = cfg.hpMult;
  room.waveSpeedMult = cfg.speedMult;
}

function startGame() {
  const p1Xp = room.playerXp.p1;
  const p2Xp = room.playerXp.p2;
  room.players.p1 = makePlayer(1, p1Xp);
  room.players.p2 = (room.gameMode !== 'waves') ? makePlayer(2, p2Xp) : null;
  if (room.players.p1 && room.playerSkins.p1) room.players.p1.skin = room.playerSkins.p1;
  if (room.players.p2 && room.playerSkins.p2) room.players.p2.skin = room.playerSkins.p2;
  if (room.players.p1 && room.playerUnlocks.p1) room.players.p1.unlockedWeapons = room.playerUnlocks.p1;
  if (room.players.p2 && room.playerUnlocks.p2) room.players.p2.unlockedWeapons = room.playerUnlocks.p2;
  room.monsters   = [];
  room.projectiles = [];
  room.particles  = [];
  room.unlockQueues = { p1: [], p2: [] };
  room.gameState  = 'GAMEPLAY';
  if (room.gameMode !== 'pvp') startWave(1);
}

function applyDamage(target, dmg, attackerKey) {
  if (target.invincible > 0) return;
  if (room.gameMode === 'coop' && target.num && (attackerKey === 'p1' || attackerKey === 'p2')) return;
  target.hp -= dmg;
  target.hitFlash  = 200;
  target.invincible = target.num ? 500 : 300;
  if (target.hp <= 0) handleKill(target, attackerKey);
}

function handleKill(target, attackerKey) {
  const isPlayer = !!target.num;
  const baseGain  = isPlayer ? 15 : 6;
  const xpGain    = room.gameMode === 'waves' ? baseGain * 2 : baseGain;

  // Credit XP to attacking player
  if (attackerKey === 'p1' || attackerKey === 'p2') {
    const pw = room.passwords[attackerKey];
    const admin = isAdminPw(pw);
    const oldXp = room.playerXp[attackerKey];
    room.playerXp[attackerKey] += xpGain;
    if (!admin) setPlayerXp(pw, room.playerXp[attackerKey]);

    const newUnlocks = checkNewUnlocks(oldXp, room.playerXp[attackerKey]);
    room.unlockQueues[attackerKey].push(...newUnlocks);
    const merged = sortWeaponIds([
      ...(room.players[attackerKey].unlockedWeapons || []),
      ...getUnlockedWeaponIds(room.playerXp[attackerKey]),
    ]);
    room.players[attackerKey].unlockedWeapons = merged;
    room.playerUnlocks[attackerKey] = merged;
    if (!admin) saveStoredWeapons(pw, merged);
  }

  room.particles.push({
    type: 'xp', x: target.x + target.w / 2, y: target.y,
    text: '+' + xpGain, timer: 900,
  });

  if (isPlayer) {
    target.dead = true;
    target.lives--;
    target.hp = 0;
    if (target.lives > 0) target.respawnTimer = 2000;
  } else {
    room.monsters = room.monsters.filter(m => m !== target);
    room.wave.monstersLeft--;
  }
}

function respawnPlayer(p) {
  p.hp = p.maxHp;
  p.x  = p.num === 1 ? 80 : 388;
  p.y  = CANVAS_H / 2;
  p.dead = false;
  p.invincible = 2000;
  p.hitFlash   = 0;
}

function checkRoundEnd() {
  const p1 = room.players.p1;
  const p2 = room.players.p2;

  if (room.gameMode === 'waves') {
    if (p1 && p1.dead && p1.lives <= 0) {
      room.lastLeaderboard = addLeaderboardEntry(room.playerNames.p1, room.wave.num);
      room.gameState     = 'ROUND_OVER';
      room.roundOverTimer = 6000;
    }
    return;
  }

  if (room.gameMode === 'coop') {
    const p1Out = !p1 || (p1.dead && p1.lives <= 0);
    const p2Out = !p2 || (p2.dead && p2.lives <= 0);
    if (p1Out && p2Out) { room.gameState = 'ROUND_OVER'; room.roundOverTimer = 4000; }
  } else {
    if (!p1 || !p2) return;
    if ((p1.dead && p1.lives <= 0) || (p2.dead && p2.lives <= 0)) {
      if (p2.dead && p2.lives <= 0) room.round.p1Wins++;
      if (p1.dead && p1.lives <= 0) room.round.p2Wins++;
      room.gameState     = 'ROUND_OVER';
      room.roundOverTimer = 4000;
    }
  }
}

// ─── Game Loop ────────────────────────────────────────────────────────────────

setInterval(() => {
  if (room.gameState !== 'GAMEPLAY') {
    if (room.gameState === 'ROUND_OVER') {
      room.roundOverTimer -= TICK_MS;
      if (room.roundOverTimer <= 0) {
        const hasUnlocks = room.unlockQueues.p1.length > 0 ||
                           (room.gameMode !== 'waves' && room.unlockQueues.p2.length > 0);
        if (hasUnlocks) {
          room.gameState = 'WEAPON_UNLOCK';
        } else if (room.gameMode === 'waves') {
          // Close P1 connection → client returns to start screen
          if (room.p1) try { room.p1.close(); } catch {}
        } else {
          startGame();
        }
      }
    }
    if (room.gameState === 'WEAPON_UNLOCK') {
      // Handled by ack_unlock messages
    }
    broadcastState();
    return;
  }

  const dt     = TICK_MS;
  const factor = dt / 16.67;

  // Detect just-pressed for attack/swap
  for (const key of ['p1', 'p2']) {
    const inp  = room.inputs[key];
    const prev = room.prevInputs[key];
    room.attackJustPressed[key]  = inp.attack  && !prev.attack;
    room.swapJustPressed[key]    = inp.swap    && !prev.swap;
    room.specialJustPressed[key] = inp.special && !prev.special;
    room.parryJustPressed[key]   = inp.parry   && !prev.parry;
    room.prevInputs[key] = { attack: inp.attack, swap: inp.swap, special: inp.special, parry: inp.parry };
  }

  // ── Move players ──
  for (const key of ['p1', 'p2']) {
    const p = room.players[key];
    if (!p || p.dead) {
      if (p && p.respawnTimer > 0) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) respawnPlayer(p);
      }
      continue;
    }
    const inp = room.inputs[key];
    let vx = 0, vy = 0;
    if (inp.left)  { vx = -p.speed; p.facing = -1; }
    if (inp.right) { vx =  p.speed; p.facing =  1; }
    if (inp.up)    vy = -p.speed;
    if (inp.down)  vy =  p.speed;
    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }

    p.x = Math.max(ARENA_X + 2, Math.min(ARENA_X + ARENA_W - p.w - 2, p.x + vx * factor));
    p.y = Math.max(ARENA_Y + 2, Math.min(ARENA_Y + ARENA_H - p.h - 2, p.y + vy * factor));

    if (p.atkCooldown     > 0) p.atkCooldown     -= dt;
    if (p.specialCooldown > 0) p.specialCooldown -= dt;
    if (p.parryCooldown   > 0) p.parryCooldown   -= dt;
    if (p.parryTimer      > 0) p.parryTimer      -= dt;
    if (p.invincible      > 0) p.invincible      -= dt;
    if (p.hitFlash        > 0) p.hitFlash        -= dt;
    if (p.swingTimer      > 0) p.swingTimer      -= dt;

    if (room.swapJustPressed[key]) {
      p.weaponIdx = (p.weaponIdx + 1) % p.unlockedWeapons.length;
    }
    if (room.attackJustPressed[key] && p.atkCooldown <= 0) {
      doAttack(p, key);
    }
    if (room.specialJustPressed[key] && p.specialCooldown <= 0) {
      doSpecial(p, key);
    }
    if (room.parryJustPressed[key] && p.parryCooldown <= 0) {
      p.parryTimer    = PARRY_WINDOW;
      p.parryCooldown = PARRY_COOLDOWN;
      spawnParrySpark(p.x + p.w / 2, p.y + p.h / 2);
    }
  }

  // ── Monsters ──
  for (const m of room.monsters) {
    let nearest = null, bestDist = Infinity;
    for (const p of [room.players.p1, room.players.p2]) {
      if (!p || p.dead) continue;
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if (d < bestDist) { bestDist = d; nearest = p; }
    }
    if (!nearest) continue;

    const dx = nearest.x - m.x, dy = nearest.y - m.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist > m.atkRange) {
      m.x += (dx / dist) * m.speed * factor;
      m.y += (dy / dist) * m.speed * factor;
      m.x = Math.max(ARENA_X + 1, Math.min(ARENA_X + ARENA_W - m.w - 1, m.x));
      m.y = Math.max(ARENA_Y + 1, Math.min(ARENA_Y + ARENA_H - m.h - 1, m.y));
    }

    if (dist <= m.atkRange + 4 && m.atkCooldown <= 0) {
      if (nearest.parryTimer > 0) {
        // Parried: reflect the blow back onto the monster
        applyDamage(m, Math.round(m.atkDamage * PARRY_REFLECT) + 10, playerKeyOf(nearest));
        spawnParrySpark(nearest.x + nearest.w / 2, nearest.y + nearest.h / 2);
      } else {
        applyDamage(nearest, m.atkDamage, 'monster');
      }
      m.atkCooldown = 1200;
    }
    if (m.atkCooldown > 0) m.atkCooldown -= dt;
    if (m.hitFlash    > 0) m.hitFlash    -= dt;
    if (m.invincible  > 0) m.invincible  -= dt;
  }

  // ── Projectiles ──
  room.projectiles = room.projectiles.filter(proj => {
    proj.x += proj.dx * factor;
    proj.y += proj.dy * factor;
    proj.traveled += Math.hypot(proj.dx, proj.dy) * factor;

    if (proj.x < ARENA_X || proj.x > ARENA_X + ARENA_W ||
        proj.y < ARENA_Y || proj.y > ARENA_Y + ARENA_H) {
      if (proj.isAoe) detonateAoe(proj);
      return false;
    }
    if (proj.traveled >= proj.maxRange) {
      if (proj.isAoe) detonateAoe(proj);
      return false;
    }

    const targets = [
      ...(proj.owner !== 'p1' ? [room.players.p1] : []),
      ...(proj.owner !== 'p2' ? [room.players.p2] : []),
      ...room.monsters,
    ].filter(t => t && !t.dead);

    let shouldRemove = false;
    for (const t of targets) {
      if (aabb({ x: proj.x - 3, y: proj.y - 3, w: 6, h: 6 }, t)) {
        const tk = playerKeyOf(t);
        if (tk && t.parryTimer > 0) {
          // Parried: bounce the projectile back at its owner
          proj.dx = -proj.dx; proj.dy = -proj.dy;
          proj.owner = tk;
          proj.traveled = 0;
          proj.damage = Math.round(proj.damage * PARRY_REFLECT);
          if (proj.hitTargets) proj.hitTargets.clear();
          spawnParrySpark(proj.x, proj.y);
          shouldRemove = false;
          break;
        }
        if (proj.isAoe) {
          detonateAoe(proj);
          shouldRemove = true;
          break;
        } else if (proj.pierce) {
          const tId = t === room.players.p1 ? 'p1' : t === room.players.p2 ? 'p2' : t.id;
          if (!proj.hitTargets.has(tId)) {
            proj.hitTargets.add(tId);
            applyDamage(t, proj.damage, proj.owner);
          }
        } else {
          applyDamage(t, proj.damage, proj.owner);
          shouldRemove = true;
          break;
        }
      }
    }
    return !shouldRemove;
  });

  // ── Wave spawner ──
  if (room.gameMode !== 'pvp') {
    if (room.wave.betweenTimer > 0) {
      room.wave.betweenTimer -= dt;
      if (room.wave.betweenTimer <= 0) startWave(room.wave.num + 1);
    } else if (room.wave.spawnQueue > 0) {
      room.wave.spawnTimer -= dt;
      if (room.wave.spawnTimer <= 0) {
        spawnMonster();
        room.wave.spawnQueue--;
        room.wave.spawnTimer = 1200;
      }
    } else if (room.wave.monstersLeft <= 0 && room.monsters.length === 0) {
      room.wave.betweenTimer = 3000;
      room.particles.push({
        type: 'waveclear', x: CANVAS_W / 2, y: CANVAS_H / 2 - 10,
        text: 'WAVE ' + room.wave.num + ' CLEAR!', timer: 2500,
      });
    }
  }

  // ── Particles ──
  room.particles = room.particles.filter(p => { p.timer -= dt; return p.timer > 0; });

  checkRoundEnd();
  broadcastState();
}, TICK_MS);

// ─── Attack Logic ─────────────────────────────────────────────────────────────

function doAttack(p, pKey) {
  const w = weapon(p);
  p.atkCooldown = w.atkSpd;
  p.swingTimer  = Math.min(w.atkSpd, 200);

  if (w.type === 'melee') {
    const targets = [
      ...(pKey !== 'p1' ? [room.players.p1] : []),
      ...(pKey !== 'p2' ? [room.players.p2] : []),
      ...room.monsters,
    ].filter(t => t && !t.dead);

    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    for (const t of targets) {
      if (Math.hypot(t.x + t.w / 2 - cx, t.y + t.h / 2 - cy) <= w.range) {
        const tk = playerKeyOf(t);
        if (tk && t.parryTimer > 0) {
          // Parried: the attacker takes the (boosted) hit instead
          applyDamage(p, Math.round(w.damage * PARRY_REFLECT), tk);
          spawnParrySpark(cx, cy);
        } else {
          applyDamage(t, w.damage, pKey);
        }
      }
    }
  } else {
    const aim = nearestTargetAngle(p, pKey);
    p.facing = Math.cos(aim) < 0 ? -1 : 1; // face the target so the weapon sprite points right way
    const speed = 3.5;
    room.projectiles.push({
      x: p.x + p.w / 2,
      y: p.y + p.h / 2,
      dx: Math.cos(aim) * speed,
      dy: Math.sin(aim) * speed,
      damage: w.damage,
      owner: pKey,
      traveled: 0,
      maxRange: w.range,
      weaponId: w.id,
      isAoe: !!w.aoeRadius,
      aoeRadius: w.aoeRadius || 0,
      pierce: !!w.pierce,
      hitTargets: w.pierce ? new Set() : null,
    });
  }
}

function nearestTargetAngle(p, pKey) {
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  const cands = [
    ...(pKey !== 'p1' ? [room.players.p1] : []),
    ...(pKey !== 'p2' ? [room.players.p2] : []),
    ...room.monsters,
  ].filter(t => t && !t.dead);
  let best = null, bd = Infinity;
  for (const t of cands) {
    const d = Math.hypot(t.x + t.w / 2 - cx, t.y + t.h / 2 - cy);
    if (d < bd) { bd = d; best = t; }
  }
  if (!best) return p.facing === 1 ? 0 : Math.PI;
  return Math.atan2(best.y + best.h / 2 - cy, best.x + best.w / 2 - cx);
}

function doSpecial(p, pKey) {
  const w = weapon(p);
  const sp = w.special;
  if (!sp) return;
  p.specialCooldown = sp.cd;
  p.swingTimer = Math.min(sp.cd, 300);

  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  const wc = WEAPON_COLORS[w.id] || '#ffffff';

  if (sp.kind === 'slam') {
    const targets = [
      ...(pKey !== 'p1' ? [room.players.p1] : []),
      ...(pKey !== 'p2' ? [room.players.p2] : []),
      ...room.monsters,
    ].filter(t => t && !t.dead);
    for (const t of targets) {
      if (Math.hypot(t.x + t.w / 2 - cx, t.y + t.h / 2 - cy) <= sp.range) {
        applyDamage(t, sp.dmg, pKey);
      }
    }
    room.particles.push({
      type: 'shockwave', x: cx, y: cy, maxR: sp.range,
      timer: 420, max: 420, color: wc,
    });
  } else {
    const aim = nearestTargetAngle(p, pKey);
    p.facing = Math.cos(aim) < 0 ? -1 : 1;
    const speed = 4.2;
    const mkProj = (angle, extra = {}) => ({
      x: cx, y: cy,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      damage: sp.dmg,
      owner: pKey,
      traveled: 0,
      maxRange: sp.range,
      weaponId: w.id,
      special: true,
      isAoe: false,
      aoeRadius: 0,
      pierce: false,
      hitTargets: null,
      ...extra,
    });

    if (sp.kind === 'pierce') {
      room.projectiles.push(mkProj(aim, { pierce: true, hitTargets: new Set() }));
    } else if (sp.kind === 'aoeshot') {
      room.projectiles.push(mkProj(aim, { isAoe: true, aoeRadius: sp.aoe || 40 }));
    } else if (sp.kind === 'spread') {
      const n = sp.count || 3;
      const fan = 0.42;
      for (let i = 0; i < n; i++) {
        const a = aim + (i - (n - 1) / 2) * fan;
        room.projectiles.push(mkProj(a));
      }
    }
  }
}

function detonateAoe(proj) {
  const targets = [room.players.p1, room.players.p2, ...room.monsters]
    .filter(t => t && !t.dead && (t !== room.players[proj.owner === 'p1' ? 'p1' : 'p2']));

  for (const t of targets) {
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    if (Math.hypot(cx - proj.x, cy - proj.y) < proj.aoeRadius) {
      applyDamage(t, proj.damage, proj.owner);
    }
  }
  room.particles.push({
    type: 'aoe', x: proj.x, y: proj.y, maxR: proj.aoeRadius,
    radius: 2, timer: 300, color: '#aa44ff',
  });
}

// ─── State Broadcast ──────────────────────────────────────────────────────────

function buildStateMsg(playerNum) {
  const p1  = room.players.p1;
  const p2  = room.players.p2;
  const key = playerNum === 1 ? 'p1' : 'p2';
  return {
    type: 'state',
    myNum: playerNum,
    gameState: room.gameState,
    gameMode: room.gameMode,
    playerNames: room.playerNames,
    players: {
      p1: p1 ? { x: p1.x, y: p1.y, w: p1.w, h: p1.h, hp: p1.hp, maxHp: p1.maxHp,
                  lives: p1.lives, facing: p1.facing, weaponId: weapon(p1).id,
                  hitFlash: p1.hitFlash, dead: p1.dead, swingTimer: p1.swingTimer,
                  unlockedWeapons: p1.unlockedWeapons, skin: p1.skin,
                  specialCd: Math.max(0, p1.specialCooldown), specialMax: weapon(p1).special?.cd || 0,
                  parryCd: Math.max(0, p1.parryCooldown), parryMax: PARRY_COOLDOWN, parryActive: p1.parryTimer > 0 } : null,
      p2: p2 ? { x: p2.x, y: p2.y, w: p2.w, h: p2.h, hp: p2.hp, maxHp: p2.maxHp,
                  lives: p2.lives, facing: p2.facing, weaponId: weapon(p2).id,
                  hitFlash: p2.hitFlash, dead: p2.dead, swingTimer: p2.swingTimer,
                  unlockedWeapons: p2.unlockedWeapons, skin: p2.skin,
                  specialCd: Math.max(0, p2.specialCooldown), specialMax: weapon(p2).special?.cd || 0,
                  parryCd: Math.max(0, p2.parryCooldown), parryMax: PARRY_COOLDOWN, parryActive: p2.parryTimer > 0 } : null,
    },
    monsters:    room.monsters.map(m => ({ x: m.x, y: m.y, w: m.w, h: m.h, hp: m.hp, maxHp: m.maxHp, hitFlash: m.hitFlash })),
    projectiles: room.projectiles.map(pr => ({ x: pr.x, y: pr.y, dx: pr.dx, dy: pr.dy, weaponId: pr.weaponId, isAoe: pr.isAoe, special: !!pr.special })),
    particles:   room.particles,
    wave:        room.wave,
    xp:          room.playerXp[key],
    round:       room.round,
    pendingUnlock: room.unlockQueues[key][0] || null,
    otherHasUnlocks: room.unlockQueues[key === 'p1' ? 'p2' : 'p1'].length > 0,
    leaderboard: room.gameMode === 'waves' && room.gameState === 'ROUND_OVER' ? room.lastLeaderboard : null,
  };
}

function broadcastState() {
  if (room.p1 && room.p1.readyState === 1) room.p1.send(JSON.stringify(buildStateMsg(1)));
  if (room.p2 && room.p2.readyState === 1) room.p2.send(JSON.stringify(buildStateMsg(2)));
}

// ─── WebSocket Connections ────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  if (room.p1 && room.p1.readyState !== 1) { room.p1 = null; room.p1Joined = false; room.playerNames.p1 = 'PLAYER 1'; }
  if (room.p2 && room.p2.readyState !== 1) { room.p2 = null; room.p2Joined = false; room.playerNames.p2 = 'PLAYER 2'; }

  if (room.p1 && room.p2) {
    ws.send(JSON.stringify({ type: 'full' }));
    ws.close();
    return;
  }

  const isP1 = !room.p1;
  if (!isP1 && room.p1Joined && room.gameMode === 'waves') {
    ws.send(JSON.stringify({ type: 'full' }));
    ws.close();
    return;
  }
  if (isP1) room.p1 = ws;
  else      room.p2 = ws;

  const myKey = isP1 ? 'p1' : 'p2';
  ws.send(JSON.stringify({ type: 'welcome', num: isP1 ? 1 : 2, leaderboard: getLeaderboard() }));

  broadcastState();

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'join') {
        const rawName = String(msg.name || '').trim().replace(/[<>&"']/g, '').slice(0, 12);
        room.playerNames[myKey] = rawName || (isP1 ? 'PLAYER 1' : 'PLAYER 2');

        const pw = String(msg.password || '').trim().replace(/[<>&"']/g, '').slice(0, 32);
        room.passwords[myKey] = pw;
        const admin = isAdminPw(pw);

        // Single progress read — merge server XP with client-cached XP (covers server restarts)
        const progress = (pw && !admin) ? loadProgress() : null;
        let progressDirty = false;

        const serverXp = progress?.players?.[pw] || 0;
        const clientXp = Math.max(0, Math.floor(Number(msg.localXp) || 0));
        const effectiveXp = admin ? ADMIN_XP : Math.max(serverXp, clientXp);
        room.playerXp[myKey] = effectiveXp;
        if (pw && !admin && effectiveXp > serverXp) {
          if (!progress.players) progress.players = {};
          progress.players[pw] = effectiveXp;
          progressDirty = true;
        }

        // Skin: if user explicitly changed it this session, save new skin; else restore saved
        const rawSkin = msg.skin && typeof msg.skin === 'object' ? msg.skin : null;
        const skinModified = !!msg.skinModified;
        const savedSkin = progress?.skins?.[pw];
        const hasSavedSkin = savedSkin !== undefined;

        let skin;
        if (skinModified || !hasSavedSkin) {
          skin = rawSkin
            ? { colorIdx: Math.max(0, Math.min(7, Number(rawSkin.colorIdx) || 0)),
                hatIdx:   Math.max(0, Math.min(4, Number(rawSkin.hatIdx)   || 0)) }
            : { colorIdx: 0, hatIdx: 0 };
          if (pw && !admin) {
            if (!progress.skins) progress.skins = {};
            progress.skins[pw] = skin;
            progressDirty = true;
          }
        } else {
          skin = {
            colorIdx: Math.max(0, Math.min(7, Number(savedSkin.colorIdx) || 0)),
            hatIdx:   Math.max(0, Math.min(4, Number(savedSkin.hatIdx)   || 0)),
          };
        }
        room.playerSkins[myKey] = skin;

        // Weapon unlocks: union of XP-derived unlocks and any previously stored unlocks
        const xpUnlocks = getUnlockedWeaponIds(effectiveXp);
        const storedWeapons = progress?.weapons?.[pw] || [];
        const unionWeapons = sortWeaponIds([...xpUnlocks, ...storedWeapons]);
        room.playerUnlocks[myKey] = unionWeapons;
        if (pw && !admin) {
          const prevStored = sortWeaponIds(storedWeapons);
          if (JSON.stringify(prevStored) !== JSON.stringify(unionWeapons)) {
            if (!progress.weapons) progress.weapons = {};
            progress.weapons[pw] = unionWeapons;
            progressDirty = true;
          }
        }

        if (pw && !admin && progressDirty) saveProgress(progress);

        // Tell client which skin is active (may restore from password if not modified)
        ws.send(JSON.stringify({ type: 'skin_init', skin }));

        if (isP1 && msg.mode) {
          room.gameMode = ['pvp', 'coop', 'waves'].includes(msg.mode) ? msg.mode : 'pvp';
        }
        if (myKey === 'p1') room.p1Joined = true;
        else                room.p2Joined = true;

        // Start game: waves = solo (P1 only), others = need both
        const canStart = room.gameMode === 'waves'
          ? room.p1Joined
          : (room.p1Joined && room.p2Joined);

        if (canStart && room.gameState === 'LOBBY') startGame();
        broadcastState();
      }

      if (msg.type === 'input') {
        room.inputs[myKey] = msg.keys;
      }

      if (msg.type === 'ack_unlock' && room.gameState === 'WEAPON_UNLOCK') {
        room.unlockQueues[myKey].shift();
        // Check if all active players are done
        const p1Done = room.unlockQueues.p1.length === 0;
        const p2Done = room.gameMode === 'waves' || !room.p2Joined || room.unlockQueues.p2.length === 0;
        if (p1Done && p2Done) {
          if (room.gameMode === 'waves') {
            if (room.p1) try { room.p1.close(); } catch {}
          } else {
            startGame();
          }
        }
      }
    } catch {}
  });

  ws.on('close', () => {
    if (room.p1 === ws) { room.p1 = null; room.p1Joined = false; room.playerNames.p1 = 'PLAYER 1'; room.passwords.p1 = ''; }
    if (room.p2 === ws) { room.p2 = null; room.p2Joined = false; room.playerNames.p2 = 'PLAYER 2'; room.passwords.p2 = ''; }
    room.gameState   = 'LOBBY';
    room.gameMode    = 'pvp';
    room.players     = { p1: null, p2: null };
    room.playerXp    = { p1: 0, p2: 0 };
    room.playerSkins = { p1: null, p2: null };
    room.playerUnlocks = { p1: null, p2: null };
    room.unlockQueues = { p1: [], p2: [] };
    broadcastState();
  });
});

// ─── Static Files ─────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

server.listen(PORT, () => console.log('Weponare running on port', PORT));
