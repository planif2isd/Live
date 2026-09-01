const video = document.getElementById('remoteVideo');
const message = document.getElementById('message');
const messageTitle = document.getElementById('messageTitle');
const messageBody = document.getElementById('messageBody');
const hud = document.getElementById('hud');
const guestRow = document.getElementById('guestRow');
const camToggle = document.getElementById('camToggle');
const unmuteBtn = document.getElementById('unmuteBtn');
let soundEnabled = false;

const pseudoGate = document.getElementById('pseudoGate');
const pseudoForm = document.getElementById('pseudoForm');
const pseudoInput = document.getElementById('pseudoInput');

const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatCount = document.getElementById('chatCount');

const NAME_COLORS = ['#FF6B6B', '#4ECDC4', '#FFD93D', '#6BCB77', '#4D96FF', '#C780FA', '#FF922B', '#20C997'];
function colorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return NAME_COLORS[hash % NAME_COLORS.length];
}

function showMessage(title, body) {
  hud.style.display = 'none';
  video.style.display = 'none';
  message.style.display = 'block';
  messageTitle.textContent = title;
  messageBody.textContent = body;
}
function showVideo() {
  message.style.display = 'none';
  hud.style.display = 'flex';
  video.style.display = 'block';
}

// Les mobiles bloquent l'autoplay avec son : on demarre toujours coupe,
// et on propose un bouton pour activer le son (toujours autorise, car
// declenche par un geste de l'utilisateur).
function playSafely(v) {
  v.play().catch(() => { /* ignore, l'utilisateur pourra rejouer via le bouton son */ });
}
unmuteBtn.addEventListener('click', () => {
  soundEnabled = true;
  video.muted = false;
  playSafely(video);
  guestRow.querySelectorAll('video').forEach((v) => { v.muted = false; });
  unmuteBtn.style.display = 'none';
});

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
function chatName(pseudo, extra) {
  return `<span class="who tag" style="color:${colorFor(pseudo)}">${escapeHtml(pseudo)}${extra || ''}</span>`;
}

// --- tuiles des invites (autres spectateurs qui ont active leur camera) ---
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
  const v = tile.querySelector('video');
  v.muted = !soundEnabled;
  playSafely(v);
  tile.querySelector('.guest-label').textContent = label;
}
function removeGuestTile(id) {
  const tile = document.getElementById('guest-' + id);
  if (tile) tile.remove();
}

const params = new URLSearchParams(window.location.search);
const broadcasterId = params.get('room');

let pseudo = '';
let dataConn = null;
let peer = null;
let myStream = null;
let myCall = null;

if (!broadcasterId) {
  pseudoGate.style.display = 'none';
  showMessage('Lien incomplet', "Ce lien ne contient pas d'identifiant de diffusion.");
} else {
  pseudoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    pseudo = pseudoInput.value.trim().slice(0, 24) || 'Spectateur';
    pseudoGate.style.display = 'none';
    camToggle.style.display = 'block';
    startConnection();
  });
}

function startConnection() {
  showMessage('En attente du diffuseur', "La connexion va s'etablir automatiquement.");

  peer = new Peer();

  peer.on('open', () => {
    dataConn = peer.connect(broadcasterId, { metadata: { pseudo } });

    dataConn.on('open', () => {
      addChatLine('Connecte au chat.', 'system');
    });

    dataConn.on('data', (msg) => {
      if (msg.type === 'chat') {
        addChatLine(`${chatName(msg.from)}: ${escapeHtml(msg.text)}`);
      } else if (msg.type === 'system') {
        addChatLine(escapeHtml(msg.text), 'system');
      } else if (msg.type === 'viewer-count') {
        chatCount.textContent = `${msg.count} spectateur${msg.count > 1 ? 's' : ''}`;
      }
    });

    dataConn.on('error', () => {
      showMessage('Diffusion introuvable', "Ce lien n'est plus actif ou n'a jamais existe.");
    });
  });

  // Le diffuseur nous appelle : soit avec le flux principal, soit avec le
  // flux camera d'un autre spectateur (relaye via le diffuseur).
  peer.on('call', (call) => {
    const kind = call.metadata && call.metadata.kind;
    call.answer();
    call.on('stream', (stream) => {
      if (kind === 'guest') {
        const label = (call.metadata && call.metadata.pseudo) || 'Invite';
        upsertGuestTile(call.metadata.guestId, stream, label);
      } else {
        video.srcObject = stream;
        showVideo();
        playSafely(video);
        if (!soundEnabled) unmuteBtn.style.display = 'block';
      }
    });
    call.on('close', () => {
      if (kind === 'guest') {
        removeGuestTile(call.metadata.guestId);
      } else {
        showMessage('Diffusion terminee', 'Le diffuseur a mis fin au direct.');
      }
    });
  });

  peer.on('error', (err) => {
    console.error(err);
    if (err.type === 'peer-unavailable') {
      showMessage('Diffusion introuvable', "Ce lien n'est plus actif ou n'a jamais existe.");
    }
  });
}

// --- activer/couper sa propre camera pour rejoindre le direct en tant qu'invite ---
camToggle.addEventListener('click', async () => {
  if (myStream) {
    stopOwnCamera();
    return;
  }
  try {
    myStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    alert("Impossible d'acceder a la camera/micro: " + err.message);
    return;
  }
  upsertGuestTile('self', myStream, `${pseudo} (toi)`);
  document.querySelector('#guest-self video').muted = true;
  camToggle.textContent = 'Couper ma camera';
  camToggle.classList.add('active');
  myCall = peer.call(broadcasterId, myStream, { metadata: { kind: 'guest', pseudo } });
  myCall.on('close', stopOwnCamera);
});

function stopOwnCamera() {
  if (myStream) myStream.getTracks().forEach((t) => t.stop());
  if (myCall) myCall.close();
  myStream = null;
  myCall = null;
  removeGuestTile('self');
  camToggle.textContent = 'Activer ma camera';
  camToggle.classList.remove('active');
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !dataConn || !dataConn.open) return;
  dataConn.send({ type: 'chat', text });
  addChatLine(`${chatName(pseudo, ' (toi)')}: ${escapeHtml(text)}`);
  chatInput.value = '';
});

window.addEventListener('beforeunload', () => {
  if (myStream) stopOwnCamera();
});
