/**
 * Haniyeh J
 * Space Invaders (SVG) with:
 * - Classic green bunkers (3/2/1 by Easy/Medium/Hard)
 * - Enemy bullets erode bunkers (always hit the TOPMOST block first)
 * - Level progression: Easy -> Medium -> Hard
 * - Player cannot shoot while under a bunker
 * - Player fire rate limit + multiple bullets allowed (varies by difficulty)
 */
const svg = document.getElementById("canvas");
const svgNS = "http://www.w3.org/2000/svg";

const startButton = document.getElementById("startBtn");
const difficultySelect = document.getElementById("difficultySelect"); // shown but locked during runs

// ---- Level progression ----
const LEVELS = ["Easy", "Medium", "Hard"];
let currentLevelIndex = 0;
let level = LEVELS[currentLevelIndex]; // start on Easy

// ---- Game state ----
let bullets = [];          // player's bullets
let enemyBullets = [];
let enemies = [];
let player = {};
let gameOver = false;

let speed = 0.5;           // enemy horizontal speed
let eBulletSpeed = 4;      // enemy bullet speed (overridden per level)
let shootInterval = 2000;  // enemy fire interval (overridden per level)
let enemyShootTimer = null;

let health = 3;

// --- player fire control (prevents "laser line") ---
let lastShotTime = 0;
const MIN_SHOT_MS = 200;     // tweak for faster/slower firing
let maxPlayerBullets = 2;    // will be set per difficulty in adjustDifficulty()

// ===== BARRIERS (classic arch) =====
let barrierBlocks = []; // SVG rect nodes

// 12 x 6 mask: 1 = block present, 0 = hole (makes the arch)
const BARRIER_SHAPE = [
  [0,1,1,1,1,1,1,1,1,1,1,0],
  [1,1,1,1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1,1,1,1],
  [1,1,1,1,0,0,0,0,1,1,1,1],
  [1,1,1,0,0,0,0,0,0,1,1,1],
  [1,1,0,0,0,0,0,0,0,0,1,1]
];

const BLOCK = 6;                         // pixel size of each mini block
const BARRIER_W = BARRIER_SHAPE[0].length * BLOCK;
const BARRIER_H = BARRIER_SHAPE.length * BLOCK;
const BARRIER_Y = 360;                   // vertical placement above player

function removeBarriers() {
  for (const r of barrierBlocks) r.remove();
  barrierBlocks = [];
}
function drawBarrierAt(xLeft, yTop = BARRIER_Y) {
  for (let r = 0; r < BARRIER_SHAPE.length; r++) {
    for (let c = 0; c < BARRIER_SHAPE[r].length; c++) {
      if (BARRIER_SHAPE[r][c] === 1) {
        const block = document.createElementNS(svgNS, "rect");
        block.setAttribute("x", xLeft + c * BLOCK);
        block.setAttribute("y", yTop + r * BLOCK);
        block.setAttribute("width", BLOCK);
        block.setAttribute("height", BLOCK);
        block.setAttribute("class", "barrier-block");
        svg.appendChild(block);
        barrierBlocks.push(block);
      }
    }
  }
}
// Easy=3, Medium=2, Hard=1
function drawBarriersForLevel() {
  removeBarriers();
  const count = (level === "Easy") ? 3 : (level === "Medium") ? 2 : 1;
  const svgWidth = 500;
  const spacing = (svgWidth - count * BARRIER_W) / (count + 1);
  for (let i = 0; i < count; i++) {
    const xLeft = Math.round(spacing * (i + 1) + BARRIER_W * i);
    drawBarrierAt(xLeft);
  }
}
// ===== END BARRIERS =====

// Keep the dropdown in sync with the current level and disable during play
function syncDifficultyUI(disabled) {
  difficultySelect.value = level;
  difficultySelect.disabled = !!disabled;
}

// Difficulty selector (allow manual change only when not in a run)
difficultySelect.addEventListener("change", function (e) {
  if (!gameOver && enemies.length > 0) { // ignore changes during gameplay
    syncDifficultyUI(true);
    return;
  }
  level = e.target.value;
  currentLevelIndex = LEVELS.indexOf(level);
});

// Start / restart
startButton.addEventListener("click", () => {
  startButton.classList.add("hidden-button");
  syncDifficultyUI(true);   // lock difficulty during the run
  resetGame();
});

// Adjust enemy speed / fire rate and player bullet cap by difficulty
function adjustDifficulty() {
  if (enemyShootTimer) clearInterval(enemyShootTimer);
  const direction = speed < 0 ? -1 : 1;

  if (level === "Easy") {
    speed = 0.5 * direction;
    eBulletSpeed = 5;
    shootInterval = 1100;
    maxPlayerBullets = 2;     // allow 2 bullets on Easy
  } else if (level === "Medium") {
    speed = 1.0 * direction;
    eBulletSpeed = 10;
    shootInterval = 900;
    maxPlayerBullets = 3;     // allow 3 bullets on Medium
  } else { // Hard
    speed = 1.5 * direction;
    eBulletSpeed = 12;
    shootInterval = 100;
    maxPlayerBullets = 4;     // allow 4 bullets on Hard
  }

  enemyShootTimer = setInterval(enemyShoot, shootInterval);
}

// Controls
document.addEventListener("keydown", function(event) {
  if (gameOver || !player.dot) return;
  let x = parseFloat(player.dot.getAttribute('x'));
  if (event.key === "ArrowRight" && x < 460) {
    player.dot.setAttribute('x', x + player.v);
  } else if (event.key === "ArrowLeft" && x > 0) {
    player.dot.setAttribute('x', x - player.v);
  } else if (event.code === "Space") {
    shootPlayBullet();
  }
});

// Init player
function initPlayer() {
  player.dot = document.getElementById("player");
  player.x = 0;
  player.y = 440;
  player.v = 20;
}

// Enemies
function drawEnemies(blockSize = 3) {
  const enemyMap = [
    [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0],
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1],
    [1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1],
    [0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0]
  ];

  const positions = [0, 50, 100, 150, 200, 250]; // 6 enemies
  for (let i = 0; i < 6; i++) {
    const enemy = { x: positions[i], y: 60, blocks: [] };
    for (let row = 0; row < enemyMap.length; row++) {
      for (let col = 0; col < enemyMap[row].length; col++) {
        if (enemyMap[row][col] === 1) {
          const block = document.createElementNS(svgNS, "rect");
          block.setAttribute("x", enemy.x + col * blockSize);
          block.setAttribute("y", enemy.y + row * blockSize);
          block.setAttribute("width", blockSize);
          block.setAttribute("height", blockSize);
          block.setAttribute("fill", "violet");
          svg.appendChild(block);
          enemy.blocks.push(block);
        }
      }
    }
    enemies.push(enemy);
  }
}

// Move enemies
function updateEnemies() {
  if (gameOver) return;
  const enemyWidth = 11 * 3;
  const svgWidth = 500;

  for (let enemy of enemies) {
    enemy.x += speed;
    if (enemy.x + enemyWidth >= svgWidth || enemy.x <= 0) {
      speed = -speed;
      break;
    }
  }
  for (let enemy of enemies) {
    for (let block of enemy.blocks) {
      let x = parseFloat(block.getAttribute("x"));
      block.setAttribute("x", x + speed);
    }
  }
}

// Player bullet — blocked if under bunker + rate-limited + max bullets
function shootPlayBullet() {
  if (!player.dot || gameOver) return;

  // Prevent shooting if player is under a barrier
  const playerX = parseFloat(player.dot.getAttribute("x"));
  const playerWidth = 36;
  const playerCenter = playerX + playerWidth / 2;
  const playerTopY = parseFloat(player.dot.getAttribute("y"));

  for (const block of barrierBlocks) {
    const bx = parseFloat(block.getAttribute("x"));
    const by = parseFloat(block.getAttribute("y"));
    if (by < playerTopY && playerCenter >= bx && playerCenter <= bx + BLOCK) {
      return; // can't shoot while under a bunker
    }
  }

  // --- fire rate limit & multi-bullet rule ---
  const now = performance.now();
  if (now - lastShotTime < MIN_SHOT_MS) return;         // too soon
  if (bullets.length >= maxPlayerBullets) return;       // reached on-screen cap

  // Fire
  const newBullet = document.createElementNS(svgNS, "circle");
  newBullet.setAttribute("r", 5);
  newBullet.setAttribute("fill", "white");
  newBullet.setAttribute("cx", 15 + playerX);
  newBullet.setAttribute("cy", 453);
  svg.appendChild(newBullet);
  bullets.push(newBullet);

  lastShotTime = now;
}

// Move player bullets; hit enemies
function moveBullets() {
  const bulletSpeed = -5;
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (!b) continue;
    let cy = parseFloat(b.getAttribute("cy"));
    let cx = parseFloat(b.getAttribute("cx"));
    cy += bulletSpeed;

    if (cy < 0) {
      b.remove();
      bullets.splice(i, 1);
      continue;
    }
    b.setAttribute("cy", cy);

    for (let j = 0; j < enemies.length; j++) {
      const enemy = enemies[j];
      const enemyLeft = enemy.x;
      const enemyRight = enemy.x + 11 * 3;
      const enemyTop = enemy.y;
      const enemyBottom = enemy.y + 8 * 3;

      const hit =
        cx + 5 >= enemyLeft &&
        cx - 5 <= enemyRight &&
        cy - 5 >= enemyTop &&
        cy + 5 <= enemyBottom;

      if (hit) {
        for (const block of enemy.blocks) block.remove();
        enemies.splice(j, 1);
        b.remove();
        bullets.splice(i, 1);
        if (enemies.length === 0) showWin();
        break;
      }
    }
  }
}

// Enemy shooting
function enemyShoot() {
  if (gameOver || enemies.length === 0) return;
  const randomEnemy = enemies[Math.floor(Math.random() * enemies.length)];

  const enemyWidth = 33;  // 11 blocks * 3
  const enemyHeight = 24; // 8 blocks * 3

  const eBullet = document.createElementNS(svgNS, "circle");
  eBullet.setAttribute("r", 5);
  eBullet.setAttribute("class", "enemy-bullet");

  const bx = randomEnemy.x + enemyWidth / 2;
  const by = randomEnemy.y + enemyHeight;

  eBullet.setAttribute("cx", bx);
  eBullet.setAttribute("cy", by);

  svg.appendChild(eBullet);
  enemyBullets.push(eBullet);
}

// Move enemy bullets; collide with bunkers (TOPMOST block), then player
function moveEnemyBullet() {
  if (gameOver) return;

  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const bullet = enemyBullets[i];
    let cy = parseFloat(bullet.getAttribute("cy"));
    let cx = parseFloat(bullet.getAttribute("cx"));
    cy += eBulletSpeed;
    bullet.setAttribute("cy", cy);

    // off screen
    if (cy > 500) {
      bullet.remove();
      enemyBullets.splice(i, 1);
      continue;
    }

    // ---- barrier collision (destroy the TOPMOST colliding block) ----
    const br = 5; // enemy bullet radius
    let topmostIndex = -1;
    let topmostBlock = null;
    let topmostY = Infinity;

    for (let k = 0; k < barrierBlocks.length; k++) {
      const block = barrierBlocks[k];
      const bx = parseFloat(block.getAttribute("x"));
      const by = parseFloat(block.getAttribute("y"));
      const bw = BLOCK, bh = BLOCK;

      const hit =
        (cx + br) >= bx &&
        (cx - br) <= (bx + bw) &&
        (cy + br) >= by &&
        (cy - br) <= (by + bh);

      if (hit && by < topmostY) {
        topmostY = by;
        topmostIndex = k;
        topmostBlock = block;
      }
    }

    if (topmostBlock) {
      topmostBlock.remove();
      barrierBlocks.splice(topmostIndex, 1);
      bullet.remove();
      enemyBullets.splice(i, 1);
      continue; // handled this bullet; go to next
    }
    // ---- end barrier collision ----

    // Player bounds
    const playerLeft = parseFloat(player.dot.getAttribute("x"));
    const playerRight = playerLeft + 36;
    const playerTop = parseFloat(player.dot.getAttribute("y"));
    const playerBottom = playerTop + 10;

    const hitPlayer =
      (cx + br) >= playerLeft &&
      (cx - br) <= playerRight &&
      (cy + br) >= playerTop &&
      (cy - br) <= playerBottom;

    if (hitPlayer) {
      bullet.remove();
      enemyBullets.splice(i, 1);
      health -= 1;
      document.getElementById("health-display").textContent = "Health: " + health;
      if (health <= 0) {
        player.dot.remove();
        showGameOver();
        gameOver = true;
      }
    }
  }
}

// Win / Game Over with progression
function showWin() {
  clearInterval(enemyShootTimer);
  gameOver = true;

  // Clean bullets so they don't keep moving during message
  for (let b of enemyBullets) b.remove();
  enemyBullets = [];
  for (const b of bullets) b.remove();
  bullets = [];

  // Advance if not last level; else final victory
  const isLast = currentLevelIndex >= LEVELS.length - 1;

  const text = document.createElementNS(svgNS, "text");
  text.setAttribute("x", isLast ? 75 : 132);
  text.setAttribute("y", 250);
  text.setAttribute("fill", "lightblue");
  text.setAttribute("font-family", "'Press Start 2P', monospace");
  text.setAttribute("font-size", "20");
  text.textContent = isLast ? "YOU BEAT THE GAME!" : "LEVEL CLEAR!";
  svg.appendChild(text);

  if (!isLast) {
    // progress to next level automatically
    currentLevelIndex += 1;
    level = LEVELS[currentLevelIndex];
    setTimeout(() => {
      text.remove();
      syncDifficultyUI(true);
      resetGame();
    }, 1200);
  } else {
    // final: show Play Again and unlock dropdown
    startButton.textContent = "Play Again";
    startButton.classList.remove("hidden-button");
    syncDifficultyUI(false);
  }
}

function showGameOver() {
  clearInterval(enemyShootTimer);
  const gameoverText = document.createElementNS(svgNS, "text");
  gameoverText.setAttribute("x", 124);
  gameoverText.setAttribute("y", 250);
  gameoverText.setAttribute("fill", "red");
  gameoverText.setAttribute("font-family", "'Press Start 2P', monospace");
  gameoverText.setAttribute("font-size", "30");
  gameoverText.textContent = "Game Over";
  svg.appendChild(gameoverText);
  for (let b of enemyBullets) b.remove();
  gameOver = true;
  for (const b of bullets) b.remove();
  bullets = [];
  startButton.textContent = "Play Again";
  startButton.classList.remove("hidden-button");

  // After a game over, allow player to change starting level if desired
  syncDifficultyUI(false);
}

// Reset game for current level
function resetGame() {
  gameOver = false;
  health = 3;
  lastShotTime = 0;
  document.getElementById("health-display").textContent = "Health: " + health;

  // wipe enemies
  for (const enemy of enemies) for (const block of enemy.blocks) block.remove();
  enemies = [];

  // wipe bullets
  for (const b of bullets) b.remove(); bullets = [];
  for (const b of enemyBullets) b.remove(); enemyBullets = [];

  // wipe barriers & texts
  removeBarriers();
  svg.querySelectorAll("text").forEach(t => t.remove());

  // reset player
  const existingPlayer = document.getElementById("player");
  if (existingPlayer) existingPlayer.remove();

  const newPlayer = document.createElementNS(svgNS, "rect");
  newPlayer.setAttribute("id", "player");
  newPlayer.setAttribute("height", "10");
  newPlayer.setAttribute("width", "36");
  newPlayer.setAttribute("x", "0");
  newPlayer.setAttribute("y", "450");
  newPlayer.setAttribute("stroke", "green");
  newPlayer.setAttribute("fill", "lightgreen");
  newPlayer.setAttribute("rx", "3");
  newPlayer.setAttribute("ry", "3");
  svg.appendChild(newPlayer);

  speed = Math.abs(speed);

  // re-init for current level
  syncDifficultyUI(true);
  difficultySelect.value = level;

  initPlayer();
  drawEnemies();
  adjustDifficulty();
  drawBarriersForLevel();
}

// Game loop (~60 FPS)
setInterval(function() {
  updateEnemies();
  moveEnemyBullet();
  moveBullets();
}, 16.6);

// Initialize dropdown to Easy on first load
syncDifficultyUI(false);
difficultySelect.value = level;
