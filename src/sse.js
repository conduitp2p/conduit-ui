import { state } from './state.js';
import { handleBuyerEvent } from './buy/index.js';
import { handleCreatorEvent } from './tabs/creator.js';

function renderEvent(ev) {
  if (state.eventFilter !== 'all' && ev.role !== state.eventFilter) return;
  document.getElementById('noEvents').style.display = 'none';
  const list = document.getElementById('eventList');
  const div = document.createElement('div');
  div.className = 'event-item';
  const ts = ev.timestamp ? ev.timestamp.split('T').pop().split('.')[0] || ev.timestamp : '';
  div.innerHTML = `
    <span class="time">${ts}</span>
    <span class="role-tag ${ev.role || ''}">${ev.role || '?'}</span>
    <span class="type">${ev.event_type || ''}</span>
    <span class="payload">${JSON.stringify(ev.data || {}).slice(0, 120)}</span>
  `;
  list.prepend(div);
}

export async function connectSSE() {
  if (state.eventSource) state.eventSource.close();
  try {
    const r = await fetch(state.nodeUrl + '/api/events/history?limit=500');
    const history = await r.json();
    if (Array.isArray(history) && history.length) {
      for (let i = history.length - 1; i >= 0; i--) {
        const ev = history[i];
        state.events.unshift(ev);
        renderEvent(ev);
      }
      if (state.events.length > 500) state.events.splice(500);
    }
  } catch (e) {}
  state.eventSource = new EventSource(state.nodeUrl + '/api/events');
  state.eventSource.onmessage = (msg) => {
    try {
      const ev = JSON.parse(msg.data);
      state.events.unshift(ev);
      if (state.events.length > 500) state.events.pop();
      renderEvent(ev);
      handleBuyerEvent(ev);
      handleCreatorEvent(ev);
    } catch (e) {}
  };
  state.eventSource.onerror = () => {
    document.getElementById('nodeId').textContent = 'SSE disconnected — reconnecting...';
  };
}

export function setupEventFilter() {
  document.querySelectorAll('#eventFilter button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#eventFilter button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.eventFilter = btn.dataset.filter;
      document.getElementById('eventList').innerHTML = '';
      document.getElementById('noEvents').style.display = state.events.length ? 'none' : 'block';
      state.events.forEach(ev => renderEvent(ev));
    });
  });
}
