#!/usr/bin/env node
/*  evo-dashboard.js  –  Real-time Evolution Monitor
    Usage:  node evo-dashboard.js
    ------------------------------------------------------------
    • Creates an Express HTTP server on localhost:6320
    • Opens your default browser to the dashboard URL
    • Polls Redis every 2s for new evolution_log entries
    • Stores logs in a local JSON database (lowdb)
    • Broadcasts updates via WebSocket to the web page
    • Renders each bot's emotion, trait bars, belief counts, and history
*/

// ─── Dependencies ────────────────────────────────────────────
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const Redis     = require('ioredis');
const open      = require('open').default;
const { Low }   = require('lowdb');
const { JSONFile } = require('lowdb/node'); // Use lowdb's built-in node adapter

// ─── Configuration ──────────────────────────────────────────
const PORT    = 6320;
const POLL_MS = 2000;

// ─── Database Setup ─────────────────────────────────────────
const adapter = new JSONFile('db.json');
const db = new Low(adapter, { agents: {} }); // Initialize with default data

// Initialize database by reading existing data or writing default
(async () => {
  await db.read();
  if (!db.data) {
    db.data = { agents: {} }; // Ensure default structure if file is empty
    await db.write();
  }
})();

// ─── Redis & Web servers setup ─────────────────────────────
const redis  = new Redis(); // uses REDIS_URL env if set
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// ─── 1) In-memory cache for last seen timestamp per bot ─────
const lastSeen = new Map(); // coreId -> latest ts

// ─── 2) Broadcast helper ────────────────────────────────────
function broadcast(msgObj) {
  const msg = JSON.stringify(msgObj);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// ─── 3) Poll Redis, store in DB, find new entries, broadcast ─────────────
async function pollRedis() {
  try {
    const keys = await redis.keys('*:evolution_log');
    for (const key of keys) {
      const coreId = key.split(':')[0];
      const lastTs = lastSeen.get(coreId) || 0;
      const raw = await redis.lrange(key, 0, -1); // Get all entries
      if (raw.length === 0) continue;

      // Store all entries in lowdb
      const entries = raw.map(entry => JSON.parse(entry));
      db.data.agents[coreId] = db.data.agents[coreId] || {};
      db.data.agents[coreId].logs = entries;
      db.data.agents[coreId].lastUpdated = new Date().toISOString();
      await db.write();

      const latestEntry = entries[0]; // Most recent entry
      if (latestEntry.ts > lastTs) {
        lastSeen.set(coreId, latestEntry.ts);
        broadcast({ coreId, entry: latestEntry });
      }
    }
  } catch (err) {
    console.warn('[pollRedis] Error reading Redis:', err.message);
  }
}

// ─── 4) Serve single-page dashboard ─────────────────────────
app.get('/', (_, res) => {
  res.type('html').send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>NEURAL EVOLUTION MONITOR v3.1.7</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');
    
    :root {
      --bg-dark: #0a0a12;
      --bg-darker: #05050a;
      --accent-primary: #38bdff;
      --accent-secondary: #ff38bd;
      --text-primary: #e0e6ff;
      --text-secondary: #a0a6bf;
      --glow: 0 0 10px rgba(56, 189, 255, 0.3);
    }
    
    body {
      margin: 0;
      padding: 0;
      background-color: var(--bg-dark);
      color: var(--text-primary);
      font-family: 'Share Tech Mono', monospace;
      overflow-x: hidden;
    }
    
    .cyber-border {
      position: relative;
      border: 1px solid var(--accent-primary);
      box-shadow: var(--glow);
    }
    
    .cyber-border::before {
      content: '';
      position: absolute;
      top: -2px;
      left: -2px;
      right: -2px;
      bottom: -2px;
      border: 1px solid var(--accent-secondary);
      pointer-events: none;
      z-index: -1;
    }
    
    .glow-text {
      text-shadow: 0 0 8px var(--accent-primary);
    }
    
    .terminal-text {
      color: var(--text-primary);
      font-family: 'Share Tech Mono', monospace;
      white-space: pre;
    }
    
    .progress-bar {
      height: 6px;
      background: rgba(56, 189, 255, 0.2);
      position: relative;
      overflow: hidden;
    }
    
    .data-stream {
      position: relative;
      overflow: hidden;
    }
    
    .data-stream::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(transparent, var(--bg-dark) 90%);
      pointer-events: none;
    }
    
    .hex-grid {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-image: 
        radial-gradient(circle at 50% 50%, transparent 95%, rgba(56, 189, 255, 0.05) 100%),
        linear-gradient(0deg, transparent 24%, rgba(56, 189, 255, 0.05) 25%, rgba(56, 189, 255, 0.05) 26%, transparent 27%, transparent 74%, rgba(56, 189, 255, 0.05) 75%, rgba(56, 189, 255, 0.05) 76%, transparent 77%),
        linear-gradient(90deg, transparent 24%, rgba(56, 189, 255, 0.05) 25%, rgba(56, 189, 255, 0.05) 26%, transparent 27%, transparent 74%, rgba(56, 189, 255, 0.05) 75%, rgba(56, 189, 255, 0.05) 76%, transparent 77%);
      background-size: 50px 50px;
      opacity: 0.3;
      pointer-events: none;
    }
  </style>
</head>
<body class="bg-black p-4">
  <div class="hex-grid"></div>
  
  <div class="container mx-auto">
    <!-- Header -->
    <div class="flex justify-between items-center mb-6 cyber-border p-4">
      <div>
        <h1 class="text-3xl font-bold glow-text">NEURAL EVOLUTION MONITOR</h1>
        <p class="text-sm text-gray-400">v3.1.7 - REAL-TIME AGENT ANALYSIS</p>
      </div>
      <div class="flex items-center space-x-4">
        <div class="text-right">
          <div class="text-xs text-gray-400">SYSTEM TIME</div>
          <div id="system-time" class="text-xl font-mono">00:00:00.000</div>
        </div>
        <div class="w-3 h-3 rounded-full bg-green-500"></div>
      </div>
    </div>
    
    <!-- Dashboard Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
      <!-- Agent Overview -->
      <div class="cyber-border p-4">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-bold">AGENT OVERVIEW</h2>
          <div class="text-xs text-gray-400">ACTIVE: <span id="agent-count" class="text-green-400">0</span></div>
        </div>
        <div id="agent-overview" class="h-64 overflow-y-auto data-stream">
          <!-- Agent cards will be inserted here -->
        </div>
      </div>
      
      <!-- Evolution Metrics -->
      <div class="cyber-border p-4">
        <h2 class="text-xl font-bold mb-4">EVOLUTION METRICS</h2>
        <div id="evolution-chart" class="h-64"></div>
      </div>
      
      <!-- System Status -->
      <div class="cyber-border p-4">
        <h2 class="text-xl font-bold mb-4">SYSTEM STATUS</h2>
        <div class="space-y-4">
          <div>
            <div class="flex justify-between text-sm mb-1">
              <span>DATA THROUGHPUT</span>
              <span id="throughput-value">0 KB/s</span>
            </div>
            <div class="progress-bar"></div>
          </div>
          <div>
            <div class="flex justify-between text-sm mb-1">
              <span>PROCESSING LOAD</span>
              <span id="load-value">0%</span>
            </div>
            <div class="w-full bg-gray-800 rounded-full h-2.5">
              <div id="load-bar" class="bg-blue-600 h-2.5 rounded-full" style="width: 0%"></div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="cyber-border p-2 text-center">
              <div class="text-xs text-gray-400">MESSAGES</div>
              <div id="message-count" class="text-2xl font-bold">0</div>
            </div>
            <div class="cyber-border p-2 text-center">
              <div class="text-xs text-gray-400">UPDATES</div>
              <div id="update-count" class="text-2xl font-bold">0</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Detailed Agent View -->
    <div class="cyber-border p-4 mb-6">
      <h2 class="text-xl font-bold mb-4">AGENT DETAILS</h2>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div id="agent-details" class="lg:col-span-1">
          <div class="text-center py-8 text-gray-500">
            <i class="fas fa-robot text-4xl mb-2"></i>
            <p>SELECT AN AGENT TO VIEW DETAILS</p>
          </div>
        </div>
        <div class="lg:col-span-2">
          <div class="cyber-border p-4 h-full">
            <h3 class="font-bold mb-2">NEURAL ACTIVITY STREAM</h3>
            <div id="neural-activity" class="h-64 overflow-y-auto font-mono text-xs data-stream terminal-text">
              <div class="text-gray-500">// Waiting for agent selection...</div>
            </div>
            <div class="mt-4">
              <h3 class="font-bold mb-2">AGENT HISTORY</h3>
              <div id="agent-history" class="h-32 overflow-y-auto font-mono text-xs data-stream terminal-text"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Console Log -->
    <div class="cyber-border p-4">
      <div class="flex justify-between items-center mb-2">
        <h2 class="text-xl font-bold">SYSTEM CONSOLE</h2>
        <div class="text-xs text-gray-400">LOG LEVEL: <span class="text-green-400">DEBUG</span></div>
      </div>
      <div id="console-log" class="h-40 overflow-y-auto font-mono text-xs data-stream terminal-text">
        <div>> Initializing neural monitoring system...</div>
        <div>> Establishing quantum data link...</div>
        <div class="text-green-400">> Connection established with core network</div>
        <div>> Scanning for agent activity...</div>
      </div>
    </div>
  </div>

  <script>
    // System clock
    function updateClock() {
      const now = new Date();
      const timeString = now.toLocaleTimeString('en-US', { hour12: false }) + 
                         '.' + now.getMilliseconds().toString().padStart(3, '0');
      document.getElementById('system-time').textContent = timeString;
    }
    setInterval(updateClock, 50);
    updateClock();

    // System metrics
    let messageCount = 0;
    let updateCount = 0;

    function updateSystemMetrics(dataSize) {
      const throughput = Math.floor(dataSize / 1024) || Math.floor(Math.random() * 500) + 100;
      const load = Math.floor(Math.random() * 30) + 20;
      document.getElementById('throughput-value').textContent = \`\${throughput} KB/s\`;
      document.getElementById('load-value').textContent = \`\${load}%\`;
      document.getElementById('load-bar').style.width = \`\${load}%\`;
      document.getElementById('message-count').textContent = messageCount.toLocaleString();
      document.getElementById('update-count').textContent = updateCount.toLocaleString();
    }

    // Initialize WebSocket
    const ws = new WebSocket('ws://localhost:6320');
    const agents = {};
    let selectedAgentId = null;

    // Initialize evolution chart
    const evolutionChart = new ApexCharts(document.querySelector("#evolution-chart"), {
      series: [{
        name: 'Cognitive Complexity',
        data: []
      }, {
        name: 'Adaptability',
        data: []
      }, {
        name: 'Social Cohesion',
        data: []
      }],
      chart: {
        type: 'line',
        height: '100%',
        background: 'transparent',
        foreColor: '#e0e6ff',
        toolbar: { show: false },
        animations: {
          enabled: true,
          easing: 'linear',
          dynamicAnimation: {
            speed: 1000
          }
        }
      },
      colors: ['#38bdff', '#ff38bd', '#38ffbd'],
      stroke: {
        width: 2,
        curve: 'smooth'
      },
      markers: {
        size: 0
      },
      xaxis: {
        type: 'datetime',
        labels: {
          style: {
            colors: '#a0a6bf'
          }
        }
      },
      yaxis: {
        min: 0,
        max: 100,
        labels: {
          style: {
            colors: '#a0a6bf'
          }
        }
      },
      grid: {
        borderColor: 'rgba(160, 166, 191, 0.1)'
      },
      tooltip: {
        theme: 'dark'
      }
    });
    evolutionChart.render();

    // Process incoming WebSocket data
    ws.onmessage = function(event) {
      try {
        const { coreId, entry } = JSON.parse(event.data);
        messageCount++;
        updateSystemMetrics(event.data.length);

        // Update or create agent data
        if (!agents[coreId]) {
          agents[coreId] = {
            id: coreId,
            name: \`AGENT-\${coreId.split('-')[1] || coreId}\`,
            emotion: entry.emotion || 'neutral',
            traits: entry.traits || {
              creativity: 0.5,
              logic: 0.5,
              empathy: 0.5,
              aggression: 0.5,
              curiosity: 0.5
            },
            beliefs: entry.beliefs || 0,
            activity: [],
            lastUpdated: new Date(entry.ts)
          };
        } else {
          const agent = agents[coreId];
          agent.emotion = entry.emotion || agent.emotion;
          agent.traits = entry.traits || agent.traits;
          agent.beliefs = entry.beliefs || agent.beliefs;
          agent.lastUpdated = new Date(entry.ts);
        }

        // Add activity log (latest 10 entries for display)
        agents[coreId].activity.unshift({
          timestamp: new Date(entry.ts),
          message: entry.message || \`Processed update at \${new Date(entry.ts).toLocaleTimeString()}\`
        });
        if (agents[coreId].activity.length > 10) agents[coreId].activity.pop();

        updateAgentCards();
        if (selectedAgentId === coreId) selectAgent(coreId);

        // Update console log
        updateCount++;
        const consoleLog = document.getElementById('console-log');
        if (messageCount % 5 === 0) {
          const messages = [
            \`> Received update for \${coreId}\`,
            \`> Processing neural activity for \${coreId}\`,
            \`> Analyzing trait evolution for \${coreId}\`,
            \`> Updating agent \${coreId} data model\`,
            \`> Synchronizing \${coreId} with network\`
          ];
          const newEntry = document.createElement('div');
          newEntry.className = messageCount % 10 === 0 ? 'text-green-400' : '';
          newEntry.textContent = messages[Math.floor(Math.random() * messages.length)];
          consoleLog.appendChild(newEntry);
          if (consoleLog.children.length > 20) consoleLog.removeChild(consoleLog.children[0]);
          consoleLog.scrollTop = consoleLog.scrollHeight;
        }

        // Update evolution chart
        const chartData = [
          {
            name: 'Cognitive Complexity',
            data: Object.values(agents).map(agent => ({
              x: agent.lastUpdated.getTime(),
              y: (agent.traits.creativity + agent.traits.logic) * 50
            })).slice(-10)
          },
          {
            name: 'Adaptability',
            data: Object.values(agents).map(agent => ({
              x: agent.lastUpdated.getTime(),
              y: (agent.traits.curiosity + agent.traits.empathy) * 50
            })).slice(-10)
          },
          {
            name: 'Social Cohesion',
            data: Object.values(agents).map(agent => ({
              x: agent.lastUpdated.getTime(),
              y: (agent.traits.empathy + (1 - agent.traits.aggression)) * 50
            })).slice(-10)
          }
        ];
        evolutionChart.updateSeries(chartData);
      } catch (err) {
        console.error('WebSocket message processing error:', err.message);
      }
    };

    // Function to update agent cards
    function updateAgentCards() {
      const agentCount = Object.keys(agents).length;
      document.getElementById('agent-count').textContent = agentCount;
      
      const container = document.getElementById('agent-overview');
      container.innerHTML = '';
      
      Object.values(agents).forEach(agent => {
        const card = document.createElement('div');
        card.className = \`cyber-border p-3 mb-3 cursor-pointer hover:bg-gray-900 transition \${selectedAgentId === agent.id ? 'bg-gray-900' : ''}\`;
        card.onclick = () => selectAgent(agent.id);
        
        const traitValues = Object.values(agent.traits);
        const averageProgress = traitValues.reduce((sum, val) => sum + val, 0) / traitValues.length;
        
        card.innerHTML = \`
          <div class="flex justify-between items-center mb-1">
            <span class="font-bold">\${agent.name}</span>
            <span class="text-xs \${getEmotionColor(agent.emotion)}">\${agent.emotion.toUpperCase()}</span>
          </div>
          <div class="flex justify-between text-xs mb-2">
            <span>BELIEFS: \${agent.beliefs}</span>
            <span>\${formatTime(agent.lastUpdated)}</span>
          </div>
          <div class="w-full bg-gray-800 rounded-full h-1.5 mb-1">
            <div class="bg-blue-600 h-1.5 rounded-full" style="width: \${averageProgress * 100}%"></div>
          </div>
          <div class="grid grid-cols-3 gap-1 text-xs">
            <div>C: \${Math.round(agent.traits.creativity * 100)}%</div>
            <div>L: \${Math.round(agent.traits.logic * 100)}%</div>
            <div>E: \${Math.round(agent.traits.empathy * 100)}%</div>
          </div>
        \`;
        
        container.appendChild(card);
      });
    }

    // Function to select an agent
    function selectAgent(agentId) {
      selectedAgentId = agentId;
      const agent = agents[agentId];
      
      if (!agent) {
        document.getElementById('agent-details').innerHTML = \`
          <div class="text-center py-8 text-gray-500">
            <i class="fas fa-robot text-4xl mb-2"></i>
            <p>SELECT AN AGENT TO VIEW DETAILS</p>
          </div>
        \`;
        document.getElementById('neural-activity').innerHTML = \`
          <div class="text-gray-500">// Waiting for agent selection...</div>
        \`;
        document.getElementById('agent-history').innerHTML = '';
        return;
      }
      
      const detailsContainer = document.getElementById('agent-details');
      detailsContainer.innerHTML = \`
        <div class="text-center mb-4">
          <i class="fas fa-robot text-6xl mb-2 \${getEmotionColor(agent.emotion)}"></i>
          <h2 class="text-2xl font-bold">\${agent.name}</h2>
          <div class="text-sm \${getEmotionColor(agent.emotion)}">\${agent.emotion.toUpperCase()}</div>
        </div>
        
        <div class="grid grid-cols-2 gap-2 text-sm mb-4">
          <div class="cyber-border p-2">
            <div class="text-xs text-gray-400">BELIEFS</div>
            <div class="text-xl">\${agent.beliefs}</div>
          </div>
          <div class="cyber-border p-2">
            <div class="text-xs text-gray-400">LAST UPDATE</div>
            <div class="text-xl">\${formatTime(agent.lastUpdated)}</div>
          </div>
        </div>
        
        <h3 class="font-bold mb-2">TRAIT MATRIX</h3>
        \${Object.entries(agent.traits).map(([trait, value]) => \`
          <div class="mb-2">
            <div class="flex justify-between text-xs mb-1">
              <span>\${trait.toUpperCase()}</span>
              <span>\${Math.round(value * 100)}%</span>
            </div>
            <div class="w-full bg-gray-800 rounded-full h-1.5">
              <div class="bg-blue-600 h-1.5 rounded-full" style="width: \${value * 100}%"></div>
            </div>
          </div>
        \`).join('')}
      \`;
      
      const activityStream = document.getElementById('neural-activity');
      activityStream.innerHTML = '';
      agent.activity.forEach(activity => {
        const entry = document.createElement('div');
        entry.innerHTML = \`<span class="text-gray-500">[\${formatTime(activity.timestamp)}]</span> \${activity.message}\`;
        activityStream.appendChild(entry);
      });
      activityStream.scrollTop = activityStream.scrollHeight;

      // Display full history from database
      const historyContainer = document.getElementById('agent-history');
      historyContainer.innerHTML = '';
      const history = db.data.agents[agentId]?.logs || [];
      history.reverse().forEach(log => {
        const entry = document.createElement('div');
        entry.innerHTML = \`<span class="text-gray-500">[\${formatTime(new Date(log.ts))}]</span> \${log.message || 'Processed update'}\`;
        historyContainer.appendChild(entry);
      });
      historyContainer.scrollTop = historyContainer.scrollHeight;
    }

    // Helper functions
    function getEmotionColor(emotion) {
      const colors = {
        neutral: 'text-gray-400',
        happy: 'text-green-400',
        angry: 'text-red-400',
        curious: 'text-yellow-400',
        fearful: 'text-purple-400'
      };
      return colors[emotion] || 'text-gray-400';
    }

    function formatTime(date) {
      return date.toLocaleTimeString('en-US', { hour12: false }).split(':').slice(0, 2).join(':');
    }

    // WebSocket error handling
    ws.onopen = function() {
      const consoleLog = document.getElementById('console-log');
      const newEntry = document.createElement('div');
      newEntry.className = 'text-green-400';
      newEntry.textContent = '> WebSocket connection established';
      consoleLog.appendChild(newEntry);
      consoleLog.scrollTop = consoleLog.scrollHeight;
    };

    ws.onerror = function(error) {
      const consoleLog = document.getElementById('console-log');
      const newEntry = document.createElement('div');
      newEntry.className = 'text-red-400';
      newEntry.textContent = \`> WebSocket error: \${error.message || 'Connection failed'}\`;
      consoleLog.appendChild(newEntry);
      consoleLog.scrollTop = consoleLog.scrollHeight;
    };

    ws.onclose = function() {
      const consoleLog = document.getElementById('console-log');
      const newEntry = document.createElement('div');
      newEntry.className = 'text-red-400';
      newEntry.textContent = '> WebSocket connection closed';
      consoleLog.appendChild(newEntry);
      consoleLog.scrollTop = consoleLog.scrollHeight;
    };

    // Load initial data from database
    async function loadInitialData() {
      await db.read();
      const storedAgents = db.data.agents;
      Object.keys(storedAgents).forEach(coreId => {
        const latestLog = storedAgents[coreId].logs[0] || {};
        agents[coreId] = {
          id: coreId,
          name: \`AGENT-\${coreId.split('-')[1] || coreId}\`,
          emotion: latestLog.emotion || 'neutral',
          traits: latestLog.traits || {
            creativity: 0.5,
            logic: 0.5,
            empathy: 0.5,
            aggression: 0.5,
            curiosity: 0.5
          },
          beliefs: latestLog.beliefs || 0,
          activity: storedAgents[coreId].logs.slice(0, 10).map(log => ({
            timestamp: new Date(log.ts),
            message: log.message || \`Processed update at \${new Date(log.ts).toLocaleTimeString()}\`
          })),
          lastUpdated: new Date(storedAgents[coreId].lastUpdated || Date.now())
        };
      });
      updateAgentCards();
    }

    // Initialize with stored data
    loadInitialData();
  </script>
</body>
</html>
`);
});

// Start server, open browser, and kick off polling
server.listen(PORT, () => {
  console.log('🛰 Evolution dashboard at http://localhost:' + PORT);
  open('http://localhost:' + PORT).catch(() => {
    console.log('⚠️ Could not auto-open browser, please visit manually.');
  });
  setInterval(pollRedis, POLL_MS);
});