#!/usr/bin/env node
// File: scripts/start-with-redis.js
// =================================
//
// 1) Arranca tu copia local de Redis en vendor/redis
// 2) Ejecuta init-db, bootstrap y satellite
// 3) Detiene Redis al salir

const { spawn } = require('child_process');
const path      = require('path');
const process   = require('process');

async function runNpmScript(name) {
  return new Promise((resolve, reject) => {
    const p = spawn('npm', ['run', name], { stdio: 'inherit', shell: true });
    p.on('close', code => code === 0
      ? resolve()
      : reject(new Error(`npm run ${name} exited with code ${code}`))
    );
  });
}

(async () => {
  // 1️⃣ Ruta al binario compilado
  const redisPath = path.resolve(__dirname, '../vendor/redis/src/redis-server');

  console.log('🔄 Starting embedded Redis on port 6379 (maxclients=10000)…');
  const redis = spawn(redisPath, ['--port', '6379', '--maxclients', '10000'], {
    stdio: 'inherit'
  });

  redis.on('error', err => {
    console.error('❌ Failed to spawn redis-server:', err.message);
    process.exit(1);
  });

  // Dale un momento a Redis para que escuche
  await new Promise(r => setTimeout(r, 500));
  console.log('✅ Redis launched.');

  try {
    // 2️⃣ Inicializa la base de datos
    console.log('🔄 Running DB init…');
    await runNpmScript('init-db');

    // 3️⃣ Bootstrap de agentes
    console.log('🔄 Bootstrapping agents…');
    await runNpmScript('bootstrap');

    // 4️⃣ Arranca el Satellite
    console.log('🔄 Launching PAi-OS Satellite…');
    await runNpmScript('satellite');

    // Nota: runNpmScript('satellite') nunca sale hasta Ctrl-C
  }
  catch (err) {
    console.error('❌ Error during startup:', err);
    console.log('🔄 Shutting down Redis…');
    redis.kill();
    process.exit(1);
  }

  // 5️⃣ Captura Ctrl-C y apaga Redis
  process.on('SIGINT', () => {
    console.log('\n🔄 Shutting down Redis…');
    redis.kill();
    process.exit();
  });
})();
