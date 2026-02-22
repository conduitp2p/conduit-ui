import { state, ensureHttp } from '../state.js';
import * as d3 from 'd3';

export async function loadNetworkGraph() {
  const status = document.getElementById('netStatus');
  const container = document.getElementById('networkGraph');
  if (!state.nodeUrl) { status.textContent = 'Connect to a node first (Settings tab).'; return; }

  status.textContent = 'Discovering network...';

  const nodes = new Map();
  const channels = [];
  const contentEdges = [];
  const seenChannels = new Set();

  function addNode(pk, role, address, alias) {
    if (!pk) return;
    const existing = nodes.get(pk);
    if (existing) {
      if (role !== 'peer' && existing.role === 'peer') existing.role = role;
      if (address && !existing.address) existing.address = address;
      if (alias && !existing.alias) { existing.alias = alias; existing.label = alias; }
    } else {
      const displayLabel = alias || (pk.slice(0, 8) + '...');
      nodes.set(pk, { id: pk, label: displayLabel, alias: alias || '', role: role || 'peer', address: address || '' });
    }
  }

  function addChannels(ownerPk, chList) {
    (chList || []).forEach(ch => {
      const cpk = ch.counterparty_node_id;
      if (!cpk) return;
      const key = [ownerPk, cpk].sort().join(':') + ':' + (ch.channel_id || ch.value_sats);
      if (seenChannels.has(key)) return;
      seenChannels.add(key);
      addNode(cpk, 'peer', '');
      channels.push({
        source: ownerPk, target: cpk,
        capacity: ch.value_sats || ch.channel_value_sats || 0,
        outbound: Math.round((ch.outbound_msat || ch.outbound_capacity_msat || 0) / 1000),
        inbound: Math.round((ch.inbound_msat || ch.inbound_capacity_msat || 0) / 1000),
        usable: ch.usable || ch.is_usable || false,
        ready: ch.ready || ch.is_channel_ready || false,
      });
    });
  }

  async function fetchJson(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 5000);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      return await r.json();
    } catch (e) {
      clearTimeout(timer);
      return null;
    }
  }

  let selfPk = null;
  try {
    const info = await fetchJson(state.nodeUrl + '/api/info', 5000);
    if (info && info.node_id) {
      selfPk = info.node_id;
      addNode(selfPk, 'self', state.nodeUrl, info.node_alias || '');
      addChannels(selfPk, info.channels);
      try {
        const p2p = await fetchJson(state.nodeUrl + '/api/p2p-info', 3000);
        if (p2p && p2p.enabled && nodes.has(selfPk)) {
          nodes.get(selfPk).p2pNodeId = p2p.node_id;
        }
      } catch (_) {}
    }
  } catch (e) {}

  let listings = [], seeders = [];
  if (state.registryUrl) {
    const [lr, sr] = await Promise.all([
      fetchJson(state.registryUrl + '/api/listings', 5000),
      fetchJson(state.registryUrl + '/api/seeders?all=1', 5000),
    ]);
    listings = (lr && lr.items) || [];
    seeders = (sr && sr.items) || [];
  }

  const creatorAddrs = new Map();
  listings.forEach(l => {
    const pk = l.creator_pubkey;
    const addr = ensureHttp(l.creator_address || l.creator_ln_address);
    if (pk) { addNode(pk, 'creator', addr, l.creator_alias || ''); creatorAddrs.set(pk, addr); }
  });

  const seederAddrs = new Map();
  seeders.forEach(s => {
    const pk = s.seeder_pubkey;
    const addr = ensureHttp(s.seeder_address || s.seeder_ln_address);
    if (pk) { addNode(pk, 'seeder', addr, s.seeder_alias || ''); seederAddrs.set(pk, addr); }
  });

  const contentMap = new Map();
  listings.forEach(l => { if (l.encrypted_hash && l.creator_pubkey) contentMap.set(l.encrypted_hash, l); });
  seeders.forEach(s => {
    const listing = contentMap.get(s.encrypted_hash);
    if (listing && listing.creator_pubkey && s.seeder_pubkey && listing.creator_pubkey !== s.seeder_pubkey) {
      const key = listing.creator_pubkey + ':' + s.seeder_pubkey;
      if (!contentEdges.find(e => e.key === key)) {
        contentEdges.push({ key, creatorPk: listing.creator_pubkey, seederPk: s.seeder_pubkey, fileName: listing.file_name || '' });
      }
    }
  });

  status.textContent = 'Querying discovered nodes...';
  const addressesToQuery = new Set();
  creatorAddrs.forEach((addr) => { if (addr && addr !== state.nodeUrl) addressesToQuery.add(addr); });
  seederAddrs.forEach((addr) => { if (addr && addr !== state.nodeUrl) addressesToQuery.add(addr); });
  nodes.forEach(n => { if (n.address && n.address !== state.nodeUrl) addressesToQuery.add(n.address); });

  const fanOutResults = await Promise.allSettled(
    [...addressesToQuery].map(addr => fetchJson(addr + '/api/info', 4000))
  );
  fanOutResults.forEach(r => {
    if (r.status === 'fulfilled' && r.value && r.value.node_id) {
      const info = r.value;
      if (info.node_alias) {
        const existingNode = nodes.get(info.node_id);
        if (existingNode && !existingNode.alias) {
          existingNode.alias = info.node_alias;
          existingNode.label = info.node_alias;
        }
      }
      addChannels(info.node_id, info.channels);
    }
  });

  const advChecks = await Promise.allSettled(
    [...addressesToQuery].map(async addr => {
      const r = await fetchJson(addr + '/api/campaigns', 3000);
      if (r && (r.campaigns !== undefined)) {
        for (const [pk, n] of nodes) {
          if (n.address === addr && n.role !== 'self') { n.role = 'advertiser'; break; }
        }
      }
    })
  );

  const nodeArr = [...nodes.values()];
  const linkArr = [];

  channels.forEach(ch => {
    if (nodes.has(ch.source) && nodes.has(ch.target)) {
      linkArr.push({
        source: ch.source, target: ch.target,
        type: 'channel', capacity: ch.capacity,
        outbound: ch.outbound, inbound: ch.inbound,
        usable: ch.usable, ready: ch.ready,
      });
    }
  });

  contentEdges.forEach(ce => {
    if (nodes.has(ce.creatorPk) && nodes.has(ce.seederPk)) {
      linkArr.push({
        source: ce.creatorPk, target: ce.seederPk,
        type: 'content', fileName: ce.fileName,
      });
    }
  });

  status.textContent = nodeArr.length + ' nodes, ' + channels.length + ' channels, ' + contentEdges.length + ' content links';

  renderNetworkGraph(container, nodeArr, linkArr, selfPk);
}

function renderNetworkGraph(container, nodeArr, linkArr, selfPk) {
  d3.select(container).select('svg').remove();

  const width = container.clientWidth;
  const height = container.clientHeight || 520;

  const svg = d3.select(container).append('svg')
    .attr('width', width).attr('height', height)
    .attr('viewBox', [0, 0, width, height]);

  const g = svg.append('g');
  svg.call(d3.zoom().scaleExtent([0.3, 5]).on('zoom', (e) => g.attr('transform', e.transform)));

  const roleColor = { self: '#f0883e', creator: '#58a6ff', seeder: '#3fb950', advertiser: '#bc8cff', peer: '#8b949e' };
  const roleRadius = { self: 18, creator: 14, seeder: 12, advertiser: 13, peer: 10 };

  svg.append('defs').append('marker')
    .attr('id', 'arrowContent').attr('viewBox', '0 -4 8 8').attr('refX', 24).attr('refY', 0)
    .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
    .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', '#30363d');

  const sim = d3.forceSimulation(nodeArr)
    .force('link', d3.forceLink(linkArr).id(d => d.id).distance(d => d.type === 'channel' ? 140 : 200))
    .force('charge', d3.forceManyBody().strength(-400))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => (roleRadius[d.role] || 10) + 8));

  const link = g.append('g').selectAll('line').data(linkArr).join('line')
    .attr('stroke', d => d.type === 'channel' ? (d.usable ? '#58a6ff' : '#484f58') : '#30363d')
    .attr('stroke-width', d => {
      if (d.type === 'content') return 1;
      return Math.max(1.5, Math.min(5, (d.capacity || 0) / 50000));
    })
    .attr('stroke-dasharray', d => d.type === 'content' ? '4,4' : null)
    .attr('marker-end', d => d.type === 'content' ? 'url(#arrowContent)' : null)
    .attr('pointer-events', 'stroke');

  const node = g.append('g').selectAll('g').data(nodeArr).join('g')
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  node.append('circle')
    .attr('r', d => roleRadius[d.role] || 10)
    .attr('fill', d => roleColor[d.role] || '#8b949e')
    .attr('stroke', d => d.role === 'self' ? '#f0883e' : '#21262d')
    .attr('stroke-width', d => d.role === 'self' ? 3 : 1.5);

  node.append('text')
    .text(d => {
      if (d.alias) return d.alias;
      if (d.role === 'self') return 'You';
      return d.role.charAt(0).toUpperCase() + d.role.slice(1);
    })
    .attr('dy', d => (roleRadius[d.role] || 10) + 14)
    .attr('text-anchor', 'middle')
    .attr('fill', d => d.alias ? '#e6edf3' : '#8b949e')
    .attr('font-size', '11px')
    .attr('font-weight', d => (d.role === 'self' || d.alias) ? '600' : '400');

  node.append('text')
    .text(d => d.id.slice(0, 8) + '...')
    .attr('dy', d => (roleRadius[d.role] || 10) + 26)
    .attr('text-anchor', 'middle')
    .attr('fill', '#484f58')
    .attr('font-size', '9px')
    .attr('font-family', "'SF Mono', monospace");

  const tooltip = d3.select('#netTooltip');

  node.on('mouseenter', (e, d) => {
    let html = '';
    if (d.alias) html += '<span class="tt-label">Alias:</span> <span class="tt-value" style="font-weight:700;">' + d.alias + '</span><br>';
    html += '<span class="tt-label">Node ID:</span> <span class="tt-value">' + d.id.slice(0, 24) + '...</span><br>';
    html += '<span class="tt-label">Role:</span> <span class="tt-value">' + d.role + '</span><br>';
    if (d.address) html += '<span class="tt-label">Address:</span> <span class="tt-value">' + d.address + '</span><br>';
    if (d.p2pNodeId) html += '<span class="tt-label">P2P (iroh):</span> <span class="tt-value">' + d.p2pNodeId.slice(0, 16) + '...</span><br>';
    const nodeChannels = linkArr.filter(l => l.type === 'channel' && (l.source.id === d.id || l.target.id === d.id));
    if (nodeChannels.length) {
      html += '<span class="tt-label">Channels:</span> <span class="tt-value">' + nodeChannels.length + '</span><br>';
      let totalCap = 0;
      nodeChannels.forEach(c => totalCap += (c.capacity || 0));
      html += '<span class="tt-label">Total capacity:</span> <span class="tt-value">' + totalCap.toLocaleString() + ' sats</span>';
    }
    tooltip.html(html).style('display', 'block');
    const rect = container.getBoundingClientRect();
    tooltip.style('left', (e.clientX - rect.left + 14) + 'px').style('top', (e.clientY - rect.top - 10) + 'px');
  })
  .on('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    tooltip.style('left', (e.clientX - rect.left + 14) + 'px').style('top', (e.clientY - rect.top - 10) + 'px');
  })
  .on('mouseleave', () => tooltip.style('display', 'none'));

  link.on('mouseenter', (e, d) => {
    let html = '';
    if (d.type === 'channel') {
      html += '<span class="tt-label">Channel</span><br>';
      html += '<span class="tt-label">Capacity:</span> <span class="tt-value">' + (d.capacity || 0).toLocaleString() + ' sats</span><br>';
      html += '<span class="tt-label">Outbound:</span> <span class="tt-value">' + (d.outbound || 0).toLocaleString() + ' sats</span><br>';
      html += '<span class="tt-label">Inbound:</span> <span class="tt-value">' + (d.inbound || 0).toLocaleString() + ' sats</span><br>';
      html += '<span class="tt-label">Status:</span> <span class="tt-value">' + (d.usable ? 'Usable' : d.ready ? 'Ready' : 'Pending') + '</span>';
    } else {
      html += '<span class="tt-label">Content link</span><br>';
      if (d.fileName) html += '<span class="tt-label">File:</span> <span class="tt-value">' + d.fileName + '</span>';
    }
    tooltip.html(html).style('display', 'block');
    const rect = container.getBoundingClientRect();
    tooltip.style('left', (e.clientX - rect.left + 14) + 'px').style('top', (e.clientY - rect.top - 10) + 'px');
  })
  .on('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    tooltip.style('left', (e.clientX - rect.left + 14) + 'px').style('top', (e.clientY - rect.top - 10) + 'px');
  })
  .on('mouseleave', () => tooltip.style('display', 'none'));

  sim.on('tick', () => {
    link
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });
}
