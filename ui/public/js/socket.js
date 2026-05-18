// socket.js — Socket.IO connection management and server event handling

window.SocketManager = (function () {
  let socket = null;

  function connect(url) {
    if (socket) {
      socket.disconnect();
      socket = null;
    }

    AppState.signalingUrl = url;
    console.log('[socket] connecting to', url);

    socket = io(url, {
      transports: ['websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1500,
    });

    // ── connection lifecycle ─────────────────────────────────────────────────
    socket.on('connect', () => {
      console.log('[socket] connected', socket.id);
      AppState.connected = true;
      Alpine.store && Alpine.store('app') && Alpine.store('app').refresh
        ? Alpine.store('app').refresh()
        : null;
      app() && window._alpineApp && window._alpineApp.$nextTick(() => {});
      // Trigger Alpine reactivity
      document.dispatchEvent(new CustomEvent('socket:connected'));
    });

    socket.on('disconnect', (reason) => {
      console.log('[socket] disconnected:', reason);
      AppState.connected = false;
      document.dispatchEvent(new CustomEvent('socket:disconnected', { detail: { reason } }));
    });

    socket.on('connect_error', (err) => {
      console.warn('[socket] connect error:', err.message);
      AppState.connected = false;
      document.dispatchEvent(new CustomEvent('socket:error', { detail: { message: err.message } }));
    });

    // ── server events ────────────────────────────────────────────────────────
    socket.on('room_created', ({ code, meta }) => {
      console.log('[socket] room_created:', code);
      AppState.code = code;
      AppState.transferState = 'waiting';
      AppState.statusMessage = 'Waiting for receiver…';
      document.dispatchEvent(new CustomEvent('room:created', { detail: { code, meta } }));
    });

    socket.on('peer_ready', ({ code, meta, sender, receiver }) => {
      console.log('[socket] peer_ready — both peers in room', code);
      AppState.peerReady = true;
      AppState.transferState = 'connected';
      AppState.statusMessage = 'Peer connected. Establishing WebRTC…';
      document.dispatchEvent(new CustomEvent('room:peer_ready', {
        detail: { code, meta, sender, receiver },
      }));
    });

    socket.on('signal', ({ from, payload }) => {
      document.dispatchEvent(new CustomEvent('webrtc:signal', { detail: { from, payload } }));
    });

    socket.on('transfer_start', ({ code }) => {
      AppState.transferState = 'transferring';
      document.dispatchEvent(new CustomEvent('transfer:start', { detail: { code } }));
    });

    socket.on('transfer_progress', ({ percent, bytes }) => {
      // Update progress from remote peer (receiver gets this from sender)
      AppState.progress = percent;
      AppState.bytesTransferred = bytes;
      document.dispatchEvent(new CustomEvent('transfer:progress', { detail: { percent, bytes } }));
    });

    socket.on('transfer_complete', ({ code }) => {
      AppState.transferState = 'done';
      AppState.progress = 100;
      document.dispatchEvent(new CustomEvent('transfer:complete', { detail: { code } }));
    });

    socket.on('peer_disconnected', ({ code, reason }) => {
      console.log('[socket] peer_disconnected:', reason);
      document.dispatchEvent(new CustomEvent('room:peer_disconnected', {
        detail: { code, reason },
      }));
    });

    socket.on('room_expired', ({ code }) => {
      document.dispatchEvent(new CustomEvent('room:expired', { detail: { code } }));
    });

    socket.on('room_error', ({ code, message }) => {
      console.warn('[socket] room_error:', message);
      document.dispatchEvent(new CustomEvent('room:error', { detail: { code, message } }));
    });

    return socket;
  }

  function emit(event, data) {
    if (!socket || !socket.connected) {
      console.warn('[socket] cannot emit — not connected');
      return;
    }
    socket.emit(event, data);
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  }

  function isConnected() {
    return socket && socket.connected;
  }

  return { connect, emit, disconnect, isConnected };
})();
