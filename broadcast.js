const preview = document.getElementById('preview');
const frameEmpty = document.getElementById('frameEmpty');
const btnCam = document.getElementById('btnCam');
const btnScreen = document.getElementById('btnScreen');
const btnGoLive = document.getElementById('btnGoLive');
const btnStop = document.getElementById('btnStop');
const linkBox = document.getElementById('linkBox');
const linkInput = document.getElementById('linkInput');
const btnCopy = document.getElementById('btnCopy');
const viewersLine = document.getElementById('viewersLine');
const tally = document.getElementById('tally');
const tallyText = document.getElementById('tallyText');

const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatCount = document.getElementById('chatCount');
const guestRow = document.getElementById('guestRow');

let localStream = null;
let peer = null;
let live = false;
const calls = new Map(); // viewerId -> MediaConnection (diffusion principale vers ce spectateur)
const conns = new Map(); // viewerId -> DataConnection
const pseudos = new Map(); // viewerId -> pseudo
const guests = new Map(); // viewerId -> { call, stream, pseudo, forwards: Map(otherViewerId -> MediaConnection) }

function addChatLine(html, cls) {
  const line = document.createElement('div');
  line.className = 'chat-msg' + (cls ? ' ' + cls : '');
  line.innerHTML = html;
  chatLog.appendChild(line);
  chatLog.scrollTop = chatLog.scrollHeight;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const NAME_COLORS = ['#FF6B6B', '#4ECDC4', '#FFD93D', '#6BCB77', '#4D96FF', '#C780FA', '#FF922B', '#20C997'];
function colorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return NAME_COLORS[hash % NAME_COLORS.length];
}
function chatName(pseudo, extra) {
  return `<span class="who tag" style="color:${colorFor(pseudo)}">${escapeHtml(pseudo)}${extra || ''}</span>`;
}
function broadcastToViewers(msg, exceptId) {
  conns.forEach((conn, id) => {
    if (id !== exceptId && conn.open) conn.send(msg);
  });
}
function broadcastViewerCount() {
  broadcastToViewers({ type: 'viewer-count', count: conns.size });
  chatCount.textContent = conns.size;
}

// --- tuiles des invites (spectateurs qui ont active leur camera) ---
function upsertGuestTile(id, stream, label) {
  let tile = document.getElementById('guest-' + id);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'guest-tile';
    tile.id = 'guest-' + id;
    const v = document.createElement('video');
    v.autoplay = true;
    v.playsInline = true;
    const tag = document.createElement('div');
    tag.className = 'guest-label';
    tile.appendChild(v);
    tile.appendChild(tag);
    guestRow.appendChild(tile);
  }
  tile.querySelector('video').srcObject = stream;
  tile.querySelector('.guest-label').textContent = label;
}
function removeGuestTile(id) {
  const tile = document.getElementById('guest-' + id);
  if (tile) tile.remove();
}

// Relaie le flux camera d'un invite vers tous les AUTRES spectateurs deja connectes.
function forwardGuestToViewers(guestId, stream, pseudo) {
  const entry = guests.get(guestId);
  conns.forEach((_conn, viewerId) => {
    if (viewerId === guestId) return;
    const forwardCall = peer.call(viewerId, stream, { metadata: { kind: 'guest', guestId, pseudo } });
    entry.forwards.set(viewerId, forwardCall);
  });
}
function forwardAllActiveGuestsTo(viewerId) {
  guests.forEach((entry, guestId) => {
    if (guestId === viewerId) return;
    const forwardCall = peer.call(viewerId, entry.stream, { metadata: { kind: 'guest', guestId, pseudo: entry.pseudo } });
    entry.forwards.set(viewerId, forwardCall);
  });
}
function stopGuest(guestId) {
  const entry = guests.get(guestId);
  if (!entry) return;
  entry.forwards.forEach((c) => c.close());
  guests.delete(guestId);
  removeGuestTile(guestId);
}

function setSource(stream) {
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  localStream = stream;
  preview.srcObject = stream;
  frameEmpty.style.display = 'none';
  btnGoLive.disabled = false;
  stream.getVideoTracks()[0].addEventListener('ended', () => {
    if (live) stopBroadcast();
  });
}

btnCam.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    setSource(stream);
    btnCam.classList.add('active');
    btnScreen.classList.remove('active');
  } catch (err) {
    alert("Impossible d'acceder a la camera: " + err.message);
  }
});

btnScreen.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    setSource(stream);
    btnScreen.classList.add('active');
    btnCam.classList.remove('active');
  } catch (err) {
    alert("Impossible de capturer l'ecran: " + err.message);
  }
});

btnGoLive.addEventListener('click', () => {
  if (!localStream) return;
  btnGoLive.disabled = true;

  // Le broker public de PeerJS (0.peerjs.com) gere uniquement la mise en
  // relation initiale (signalisation). La video, elle, ne transite jamais
  // par ce serveur : elle va directement du diffuseur vers chaque spectateur.
  peer = new Peer(); // ID genere automatiquement par le broker

  peer.on('open', (id) => {
    live = true;
    const url = `${window.location.origin}${window.location.pathname.replace('broadcast.html', '')}watch.html?room=${id}`;
    linkInput.value = url;
    linkBox.classList.add('show');
    btnStop.disabled = false;
    btnCam.disabled = true;
    btnScreen.disabled = true;
    tally.classList.add('live');
    tallyText.textContent = 'EN DIRECT';
  });

  // Un spectateur ouvre d'abord une connexion de donnees pour signaler
  // sa presence (et pour le chat) ; on lui repond avec l'appel video/audio.
  peer.on('connection', (conn) => {
    conns.set(conn.peer, conn);

    conn.on('open', () => {
      const pseudo = (conn.metadata && conn.metadata.pseudo) || 'Spectateur';
      pseudos.set(conn.peer, pseudo);

      const call = peer.call(conn.peer, localStream, { metadata: { kind: 'main' } });
      calls.set(conn.peer, call);
      updateViewersLine();
      forwardAllActiveGuestsTo(conn.peer);

      const joinMsg = { type: 'system', text: `${pseudo} a rejoint le direct.` };
      addChatLine(escapeHtml(joinMsg.text), 'system');
      broadcastToViewers(joinMsg, conn.peer);
      broadcastViewerCount();
    });

    conn.on('data', (msg) => {
      if (msg.type === 'chat') {
        const pseudo = pseudos.get(conn.peer) || 'Spectateur';
        const out = { type: 'chat', from: pseudo, text: String(msg.text).slice(0, 300) };
        addChatLine(`${chatName(pseudo)}: ${escapeHtml(out.text)}`);
        broadcastToViewers(out, conn.peer);
      }
    });

    conn.on('close', () => {
      const pseudo = pseudos.get(conn.peer) || 'Spectateur';
      const call = calls.get(conn.peer);
      if (call) call.close();
      calls.delete(conn.peer);
      conns.delete(conn.peer);
      pseudos.delete(conn.peer);
      stopGuest(conn.peer);
      // Ce spectateur ne doit plus recevoir les flux des autres invites.
      guests.forEach((entry) => {
        const fwd = entry.forwards.get(conn.peer);
        if (fwd) { fwd.close(); entry.forwards.delete(conn.peer); }
      });
      updateViewersLine();

      const leaveMsg = { type: 'system', text: `${pseudo} a quitte le direct.` };
      addChatLine(escapeHtml(leaveMsg.text), 'system');
      broadcastToViewers(leaveMsg);
      broadcastViewerCount();
    });
  });

  // Un spectateur qui active sa camera nous appelle : on l'affiche localement
  // et on relaie son flux vers tous les autres spectateurs connectes.
  peer.on('call', (call) => {
    if (call.metadata && call.metadata.kind === 'guest') {
      const guestId = call.peer;
      const pseudo = call.metadata.pseudo || pseudos.get(guestId) || 'Invite';
      call.answer();
      call.on('stream', (stream) => {
        guests.set(guestId, { call, stream, pseudo, forwards: new Map() });
        upsertGuestTile(guestId, stream, pseudo);
        forwardGuestToViewers(guestId, stream, pseudo);
      });
      call.on('close', () => stopGuest(guestId));
    }
  });

  peer.on('error', (err) => {
    console.error(err);
    if (!live) {
      alert('Impossible de demarrer le direct: ' + err.type);
      btnGoLive.disabled = false;
    }
  });
});

btnStop.addEventListener('click', stopBroadcast);

function stopBroadcast() {
  broadcastToViewers({ type: 'system', text: 'Le diffuseur a mis fin au direct.' });
  calls.forEach((call) => call.close());
  calls.clear();
  guests.forEach((entry) => { entry.forwards.forEach((c) => c.close()); entry.call.close(); });
  guests.clear();
  guestRow.innerHTML = '';
  conns.clear();
  pseudos.clear();
  if (peer) peer.destroy();
  peer = null;
  live = false;
  btnGoLive.disabled = !localStream;
  btnStop.disabled = true;
  btnCam.disabled = false;
  btnScreen.disabled = false;
  tally.classList.remove('live');
  tallyText.textContent = 'HORS ANTENNE';
  linkBox.classList.remove('show');
  updateViewersLine();
  chatCount.textContent = '0';
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !live) return;
  const out = { type: 'chat', from: 'Diffuseur', text: text.slice(0, 300) };
  addChatLine(`${chatName('Diffuseur', ' (toi)')}: ${escapeHtml(out.text)}`);
  broadcastToViewers(out);
  chatInput.value = '';
});

btnCopy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(linkInput.value);
  btnCopy.textContent = 'Copie !';
  setTimeout(() => (btnCopy.textContent = 'Copier'), 1500);
});

function updateViewersLine() {
  const n = calls.size;
  viewersLine.textContent = `${n} spectateur${n > 1 ? 's' : ''} connecte${n > 1 ? 's' : ''}`;
}

window.addEventListener('beforeunload', () => {
  if (live) stopBroadcast();
});
