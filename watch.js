const video = document.getElementById('remoteVideo');
const message = document.getElementById('message');
const messageTitle = document.getElementById('messageTitle');
const messageBody = document.getElementById('messageBody');
const hud = document.getElementById('hud');

const pseudoGate = document.getElementById('pseudoGate');
const pseudoForm = document.getElementById('pseudoForm');
const pseudoInput = document.getElementById('pseudoInput');

const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatCount = document.getElementById('chatCount');

// Palette inspiree des pseudos colores type Twitch : chaque pseudo garde
// toujours la meme couleur, calculee a partir de son nom.
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

const params = new URLSearchParams(window.location.search);
const broadcasterId = params.get('room');

let pseudo = '';
let dataConn = null;

if (!broadcasterId) {
  pseudoGate.style.display = 'none';
  showMessage('Lien incomplet', "Ce lien ne contient pas d'identifiant de diffusion.");
} else {
  pseudoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    pseudo = pseudoInput.value.trim().slice(0, 24) || 'Spectateur';
    pseudoGate.style.display = 'none';
    startConnection();
  });
}

function startConnection() {
  showMessage('En attente du diffuseur', "La connexion va s'etablir automatiquement.");

  const peer = new Peer();

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

  peer.on('call', (call) => {
    call.answer(); // on ne renvoie pas de flux, on ne fait que recevoir
    call.on('stream', (stream) => {
      video.srcObject = stream;
      showVideo();
    });
    call.on('close', () => {
      showMessage('Diffusion terminee', 'Le diffuseur a mis fin au direct.');
    });
  });

  peer.on('error', (err) => {
    console.error(err);
    if (err.type === 'peer-unavailable') {
      showMessage('Diffusion introuvable', "Ce lien n'est plus actif ou n'a jamais existe.");
    }
  });
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !dataConn || !dataConn.open) return;
  dataConn.send({ type: 'chat', text });
  addChatLine(`${chatName(pseudo, ' (toi)')}: ${escapeHtml(text)}`);
  chatInput.value = '';
});
