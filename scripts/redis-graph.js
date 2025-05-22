// scripts/redis-graph.js  — pan + zoom, collapse, UID-safe
// ---------------------------------------------------------
require('dotenv').config();
const fs    = require('fs');
const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT
});

(async () => {
  /* 1. SCAN */
  const keys = [];
  let c = '0';
  do {
    const [n, batch] = await redis.scan(c, 'MATCH', '*', 'COUNT', 1000);
    c = n; keys.push(...batch);
  } while (c !== '0');

  /* 2. GROUP */
  const graph = {};
  for (const k of keys) {
    const parts = k.split(':');
    const ns  = parts.shift();
    const sub = parts.join(':') || 'core';
    graph[ns] ??= {};
    graph[ns][sub] = await redis.type(k);
  }

  /* 3. TREE */
  const data = {
    name: 'RedisCache',
    children: Object.entries(graph).map(([ns, subs]) => ({
      name: ns,
      children: Object.entries(subs).map(([s, t]) => ({
        name: `${s} (${t})`
      }))
    }))
  };

  /* 4. HTML */
  const html = `
<!DOCTYPE html><meta charset="utf-8">
<title>Redis Graph</title>
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
<style>
  html,body,svg{margin:0;width:100%;height:100%;background:#0b0f1e;font-family:system-ui}
  .link{fill:none;stroke:#556;stroke-width:1.4}
  .node text{font:12px monospace;fill:#e6e6e6;pointer-events:none}
  .node circle{fill:#1ac5ff;stroke:#0d91c0;stroke-width:1.5}
  .node--inner circle{fill:#ffb31a;stroke:#c08800}
</style>
<svg></svg>
<script>
const rootData = ${JSON.stringify(data)};

const root = d3.hierarchy(rootData);
const dx = 24, dy = 260;
d3.tree().nodeSize([dx,dy])(root);

let uid = 0;
root.each(d=>d.data._uid=++uid);

let x0=Infinity,x1=-x0;
root.each(d=>{if(d.x>x1)x1=d.x;if(d.x<x0)x0=d.x});

const svg = d3.select('svg');
const gMain = svg.append('g');

svg.call(
  d3.zoom().scaleExtent([0.1,3]).on('zoom',e=>gMain.attr('transform',e.transform))
).on('dblclick.zoom',null);

svg.attr('viewBox',[-dy/2,x0-dx*2,(root.height+4)*dy,x1-x0+dx*4]);

gMain.append('g')
  .selectAll('path')
  .data(root.links())
  .join('path')
  .attr('class','link')
  .attr('d',d3.linkHorizontal().x(d=>d.y).y(d=>d.x));

const node = gMain.append('g')
  .selectAll('g')
  .data(root.descendants())
  .join('g')
  .attr('class',d=>d.children?'node node--inner':'node')
  .attr('transform',d=>\`translate(\${d.y},\${d.x})\`)
  .on('click',(e,d)=>{d.children=d.children?null:d._children||[];update()});

node.append('circle').attr('r',5);

node.append('text')
  .attr('dy','0.31em')
  .attr('x',d=>d.children?-8:8)
  .attr('text-anchor',d=>d.children?'end':'start')
  .text(d=>d.data.name)
  .clone(true).lower().attr('stroke','#000');

root.descendants().forEach(d=>{
  if(d.depth===2&&d.children){d._children=d.children;d.children=null;}
});
update();

function update(){
  const treed=d3.tree().nodeSize([dx,dy])(root);
  treed.each(d=>{if(!d.data._uid)d.data._uid=++uid;});

  let x0=Infinity,x1=-x0;
  treed.each(d=>{if(d.x>x1)x1=d.x;if(d.x<x0)x0=d.x});
  svg.transition().duration(350)
     .attr('viewBox',[-dy/2,x0-dx*2,(root.height+4)*dy,x1-x0+dx*4]);

  const nodes=gMain.selectAll('g.node')
      .data(treed.descendants(),d=>d.data._uid);
  const links=gMain.selectAll('path.link')
      .data(treed.links(),d=>d.target.data._uid);

  links.join(
    enter=>enter.append('path').attr('class','link')
               .attr('d',d3.linkHorizontal().x(p=>p.y).y(p=>p.x)),
    upd=>upd.transition().duration(350)
               .attr('d',d3.linkHorizontal().x(p=>p.y).y(p=>p.x)),
    exit=>exit.remove()
  );

  const nEnter=nodes.enter().append('g')
      .attr('class',d=>d.children||d._children?'node node--inner':'node')
      .attr('transform',d=>\`translate(\${d.y},\${d.x})\`)
      .on('click',(e,d)=>{d.children=d.children?null:d._children||[];update()});
  nEnter.append('circle').attr('r',5);
  nEnter.append('text')
        .attr('dy','0.31em')
        .attr('x',d=>d.children||d._children?-8:8)
        .attr('text-anchor',d=>d.children||d._children?'end':'start')
        .text(d=>d.data.name)
        .clone(true).lower().attr('stroke','#000');

  nodes.merge(nEnter).transition().duration(350)
       .attr('transform',d=>\`translate(\${d.y},\${d.x})\`);
  nodes.merge(nEnter).select('text')
       .attr('x',d=>d.children||d._children?-8:8)
       .attr('text-anchor',d=>d.children||d._children?'end':'start');
}
</script>`;
  fs.writeFileSync('redis-graph.html', html, 'utf8');
  console.log('✅ redis-graph.html listo');
  process.exit();
})();
