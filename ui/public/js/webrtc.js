// webrtc.js — WebRTC: offer/answer/ICE negotiation + DataChannel file transfer

window.WebRTCManager = (function () {

  const CHUNK_SIZE = 64 * 1024; // 64 KB per chunk
  const STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  // ── Module-level state ────────────────────────────────────────────────────
  let _sendBuffer    = null;
  let _sendOffset    = 0;
  let _recvBuffers   = [];
  let _recvSize      = 0;
  let _expectedSize  = 0;
  let _recvMeta      = null;

  // Signals that arrive before the PC / remote-desc is ready are queued here
  let _pendingSignals    = [];   // whole payloads waiting for PC to exist
  let _pendingCandidates = [];   // ICE candidates waiting for remoteDescription
  let _pcExists          = false;

  // ── Create RTCPeerConnection ──────────────────────────────────────────────
  function createPeerConnection(code) {
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    AppState.peerConnection = pc;
    _pcExists = true;

    pc.onicecandidate = (evt) => {
      if (evt.candidate) {
        SocketManager.emit('signal', {
          code,
          payload: { type: 'candidate', candidate: evt.candidate },
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[webrtc] ICE:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        TransferManager.handleError('ICE connection failed — NAT traversal unsuccessful.');
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[webrtc] PC state:', pc.connectionState);
      if (pc.connectionState === 'failed') {
        TransferManager.handleError('Peer connection failed.');
      }
    };

    return pc;
  }

  // ── SENDER ────────────────────────────────────────────────────────────────
  async function startAsSender(code, file) {
    console.log('[webrtc] starting as SENDER');
    _reset();

    const pc = createPeerConnection(code);

    const dc = pc.createDataChannel('fileTransfer', { ordered: true });
    AppState.dataChannel = dc;
    _setupSenderChannel(dc, file, code);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    SocketManager.emit('signal', {
      code,
      payload: { type: 'offer', sdp: pc.localDescription },
    });
    console.log('[webrtc] offer sent');

    // Drain any signals that arrived during async setup
    await _drainPending(code);
  }

  // ── RECEIVER ──────────────────────────────────────────────────────────────
  async function startAsReceiver(code, meta) {
    console.log('[webrtc] starting as RECEIVER');
    _reset();
    _recvMeta     = meta;
    _expectedSize = meta ? meta.size : 0;

    const pc = createPeerConnection(code);

    pc.ondatachannel = (evt) => {
      console.log('[webrtc] datachannel received');
      AppState.dataChannel = evt.channel;
      _setupReceiverChannel(evt.channel, code);
    };

    // Drain any signals (offer + ICE) that arrived before PC was ready
    await _drainPending(code);
  }

  // ── Handle incoming signal (called from TransferManager) ─────────────────
  async function handleSignal(payload, code) {
    if (!_pcExists || !AppState.peerConnection) {
      console.log('[webrtc] PC not ready, queuing signal:', payload.type);
      _pendingSignals.push({ payload, code });
      return;
    }
    await _processSignal(payload, code);
  }

  // ── Process one signal against the live PC ────────────────────────────────
  async function _processSignal(payload, code) {
    const pc = AppState.peerConnection;
    if (!pc) return;

    try {
      if (payload.type === 'offer') {
        if (pc.signalingState !== 'stable') {
          console.warn('[webrtc] ignoring offer in state:', pc.signalingState);
          return;
        }
        console.log('[webrtc] got offer — creating answer');
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        await _flushCandidates(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        SocketManager.emit('signal', {
          code,
          payload: { type: 'answer', sdp: pc.localDescription },
        });
        console.log('[webrtc] answer sent');

      } else if (payload.type === 'answer') {
        if (pc.signalingState !== 'have-local-offer') {
          console.warn('[webrtc] ignoring answer in state:', pc.signalingState);
          return;
        }
        console.log('[webrtc] got answer');
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        await _flushCandidates(pc);

      } else if (payload.type === 'candidate') {
        if (!payload.candidate) return;
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } else {
          console.log('[webrtc] queuing ICE candidate (no remote desc yet)');
          _pendingCandidates.push(payload.candidate);
        }
      }
    } catch (err) {
      console.error('[webrtc] signal handling error:', err);
      TransferManager.handleError('WebRTC negotiation failed: ' + err.message);
    }
  }

  // ── Flush ICE candidates that arrived before remoteDescription was set ────
  async function _flushCandidates(pc) {
    if (_pendingCandidates.length === 0) return;
    console.log('[webrtc] flushing', _pendingCandidates.length, 'queued ICE candidates');
    const candidates = _pendingCandidates.splice(0);
    for (const c of candidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) {
        console.warn('[webrtc] addIceCandidate error:', e);
      }
    }
  }

  // ── Drain signals queued before PC existed ────────────────────────────────
  async function _drainPending(code) {
    const queued = _pendingSignals.splice(0);
    for (const item of queued) {
      console.log('[webrtc] draining queued signal:', item.payload.type);
      await _processSignal(item.payload, item.code || code);
    }
  }

  // ── Sender DataChannel ────────────────────────────────────────────────────
  function _setupSenderChannel(dc, file, code) {
    dc.bufferedAmountLowThreshold = 256 * 1024;

    dc.onopen = async () => {
      console.log('[webrtc] channel open — reading file');
      AppState.transferState = 'transferring';
      SocketManager.emit('transfer_start', { code });
      document.dispatchEvent(new CustomEvent('transfer:start', { detail: { code } }));

      _sendBuffer = await file.arrayBuffer();
      _sendOffset = 0;
      AppState.totalBytes = _sendBuffer.byteLength;

      dc.send(JSON.stringify({
        type: 'meta',
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
      }));

      _sendChunks(dc, code);
    };

    dc.onbufferedamountlow = () => {
      if (_sendBuffer && _sendOffset < _sendBuffer.byteLength) {
        _sendChunks(dc, code);
      }
    };

    dc.onerror = (err) => {
      console.error('[webrtc] channel error (sender):', err);
      TransferManager.handleError('DataChannel error while sending.');
    };

    dc.onclose = () => console.log('[webrtc] channel closed (sender)');
  }

  function _sendChunks(dc, code) {
    if (!_sendBuffer) return;

    while (_sendOffset < _sendBuffer.byteLength) {
      if (dc.bufferedAmount > 4 * 1024 * 1024) return; // back-pressure

      const end   = Math.min(_sendOffset + CHUNK_SIZE, _sendBuffer.byteLength);
      const chunk = _sendBuffer.slice(_sendOffset, end);
      dc.send(chunk);
      _sendOffset = end;

      const pct = Math.round((_sendOffset / _sendBuffer.byteLength) * 100);
      AppState.progress         = pct;
      AppState.bytesTransferred = _sendOffset;

      document.dispatchEvent(new CustomEvent('transfer:progress', {
        detail: { percent: pct, bytes: _sendOffset },
      }));
      if (pct % 2 === 0) {
        SocketManager.emit('transfer_progress', { code, percent: pct, bytes: _sendOffset });
      }
    }

    if (_sendOffset >= _sendBuffer.byteLength) {
      dc.send(JSON.stringify({ type: 'done' }));
      console.log('[webrtc] all chunks sent');
    }
  }

  // ── Receiver DataChannel ──────────────────────────────────────────────────
  function _setupReceiverChannel(dc, code) {
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      console.log('[webrtc] channel open (receiver)');
      AppState.transferState = 'transferring';
    };

    dc.onmessage = (evt) => {
      if (typeof evt.data === 'string') {
        let msg;
        try { msg = JSON.parse(evt.data); } catch (e) { return; }

        if (msg.type === 'meta') {
          _recvMeta     = { name: msg.name, size: msg.size, mime: msg.mime };
          _expectedSize = msg.size;
          _recvBuffers  = [];
          _recvSize     = 0;
          AppState.fileMeta   = _recvMeta;
          AppState.totalBytes = _expectedSize;
          console.log('[webrtc] meta received:', _recvMeta);
        } else if (msg.type === 'done') {
          _assembleFile(code);
        }
      } else {
        _recvBuffers.push(evt.data);
        _recvSize += evt.data.byteLength;

        const pct = _expectedSize
          ? Math.round((_recvSize / _expectedSize) * 100)
          : 0;
        AppState.progress         = pct;
        AppState.bytesTransferred = _recvSize;

        document.dispatchEvent(new CustomEvent('transfer:progress', {
          detail: { percent: pct, bytes: _recvSize },
        }));
        if (pct % 2 === 0) {
          SocketManager.emit('transfer_progress', { code, percent: pct, bytes: _recvSize });
        }
      }
    };

    dc.onerror = (err) => {
      console.error('[webrtc] channel error (receiver):', err);
      TransferManager.handleError('DataChannel error while receiving.');
    };

    dc.onclose = () => console.log('[webrtc] channel closed (receiver)');
  }

  function _assembleFile(code) {
    console.log('[webrtc] assembling', _recvBuffers.length, 'chunks');
    const blob = new Blob(_recvBuffers, {
      type: (_recvMeta && _recvMeta.mime) || 'application/octet-stream',
    });

    if (AppState.downloadUrl) URL.revokeObjectURL(AppState.downloadUrl);
    AppState.receivedBlob  = blob;
    AppState.downloadUrl   = URL.createObjectURL(blob);
    AppState.progress      = 100;
    AppState.transferState = 'done';

    SocketManager.emit('transfer_complete', { code });
    document.dispatchEvent(new CustomEvent('transfer:complete', { detail: { code } }));
    console.log('[webrtc] file ready for download');
  }

  // ── Internal reset ────────────────────────────────────────────────────────
  function _reset() {
    _pendingSignals    = [];
    _pendingCandidates = [];
    _pcExists          = false;
    _sendBuffer        = null;
    _sendOffset        = 0;
    _recvBuffers       = [];
    _recvSize          = 0;
    _expectedSize      = 0;
    _recvMeta          = null;
  }

  // ── Public: close and clean up ────────────────────────────────────────────
  function close() {
    _reset();
    if (AppState.dataChannel) {
      try { AppState.dataChannel.close(); } catch (_) {}
      AppState.dataChannel = null;
    }
    if (AppState.peerConnection) {
      try { AppState.peerConnection.close(); } catch (_) {}
      AppState.peerConnection = null;
    }
  }

  return { startAsSender, startAsReceiver, handleSignal, close };

})();