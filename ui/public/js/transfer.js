window.TransferManager = (function () {

  var _code = null;

  // _app is window._app set by Alpine component's init()
  function ui(patch) {
    if (window._app) window._app.update(patch);
  }

  function init() {
    // room created — sender gets the code
    document.addEventListener('room:created', function(e) {
      _code = e.detail.code;
      AppState.code = _code;
      ui({ code: _code, statusMessage: 'Share this code with the receiver.', transferState: 'waiting' });
    });

    // both peers in room — kick off WebRTC
    document.addEventListener('room:peer_ready', async function(e) {
      var detail = e.detail;
      _code = detail.code;
      AppState.peerReady = true;
      ui({ statusMessage: 'Peer connected. Establishing connection...', transferState: 'connected' });

      try {
        if (AppState.role === 'sender') {
          await WebRTCManager.startAsSender(_code, AppState.selectedFile);
        } else {
          await WebRTCManager.startAsReceiver(_code, detail.meta);
        }
      } catch (err) {
        handleError('WebRTC failed: ' + err.message);
      }
    });

    // relay signal to WebRTC layer
    document.addEventListener('webrtc:signal', function(e) {
      WebRTCManager.handleSignal(e.detail.payload, _code);
    });

    // transfer lifecycle
    document.addEventListener('transfer:start', function() {
      ui({ transferState: 'transferring', statusMessage: 'Transferring...' });
    });

    document.addEventListener('transfer:progress', function(e) {
      ui({ progress: e.detail.percent, bytesTransferred: e.detail.bytes, transferState: 'transferring' });
    });

    document.addEventListener('transfer:complete', function() {
      var msg = AppState.role === 'sender' ? 'File sent!' : 'File received!';
      ui({ transferState: 'done', progress: 100, statusMessage: msg });
      if (window._app && window._app.downloadUrl !== AppState.downloadUrl) {
        ui({ downloadUrl: AppState.downloadUrl, fileMeta: AppState.fileMeta });
      }
    });

    document.addEventListener('room:peer_disconnected', function(e) {
      if (AppState.transferState === 'done') return;
      var reason = e.detail.reason;
      if (reason === 'cancelled') {
        handleError('Transfer cancelled by the other peer.');
      } else {
        handleError('Peer disconnected.');
      }
    });

    document.addEventListener('room:expired', function() {
      handleError('Room expired — no one joined in time.');
    });

    document.addEventListener('room:error', function(e) {
      handleError(e.detail.message);
    });
  }

  function startSend(file) {
    AppState.role = 'sender';
    AppState.selectedFile = file;
    AppState.fileMeta = { name: file.name, size: file.size, type: file.type };
    AppState.totalBytes = file.size;
    AppState.transferState = 'waiting';
    SocketManager.emit('create_room', { meta: { name: file.name, size: file.size, type: file.type } });
  }

  function startReceive(code) {
    code = code.toUpperCase().trim();
    AppState.role = 'receiver';
    AppState.code = code;
    _code = code;
    AppState.transferState = 'waiting';
    SocketManager.emit('join_room', { code: code });
  }

  function cancel() {
    if (_code && AppState.transferState !== 'done') {
      SocketManager.emit('cancel_transfer', { code: _code });
    }
    WebRTCManager.close();
    AppState.reset();
    _code = null;
  }

  function handleError(msg) {
    console.error('[transfer] error:', msg);
    WebRTCManager.close();
    AppState.transferState = 'error';
    ui({ transferState: 'error', errorMessage: msg, modalOpen: true });
  }

  return { init: init, startSend: startSend, startReceive: startReceive, cancel: cancel, handleError: handleError };

})();