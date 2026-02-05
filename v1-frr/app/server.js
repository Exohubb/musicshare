import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import ffmpeg from 'fluent-ffmpeg';
import multer from 'multer';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);

// ⚡ ULTRA-LOW LATENCY OPTIMIZATIONS
const io = new Server(httpServer, { 
  cors: { origin: '*' },
  perMessageDeflate: false,    // Disable compression for audio (CRITICAL)
  maxHttpBufferSize: 1e8,
  pingTimeout: 10000,          // Faster disconnect detection
  pingInterval: 5000
});

// ═══════════════════════════════════════════════════════════
// FFMPEG SETUP
// ═══════════════════════════════════════════════════════════

try {
  const ffmpegPath = execSync('where ffmpeg', { encoding: 'utf-8' }).split('\n')[0].trim();
  ffmpeg.setFfmpegPath(ffmpegPath);
  console.log('✅ FFmpeg ready');
} catch (err) {
  console.error('❌ FFmpeg not found');
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════

const UPLOAD_DIR = join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const upload = multer({ 
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`)
  }),
  limits: { fileSize: 100 * 1024 * 1024 }
});

app.use(express.static(join(__dirname, 'public')));
app.use(express.json());

// ═══════════════════════════════════════════════════════════
// ROOM SYSTEM
// ═══════════════════════════════════════════════════════════

const rooms = new Map();
const AUTO_DELETE_TIMEOUT = 30 * 60 * 1000;

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code));
  return code;
}

function createRoom(hostSocketId, hostName) {
  const roomCode = generateRoomCode();
  
  const room = {
    code: roomCode,
    hostSocketId: hostSocketId,
    hostName: hostName || 'Host',
    listeners: new Map(),
    audioFile: null,
    metadata: null,
    playing: false,
    paused: false,
    position: 0,
    startedAt: null,
    duration: 0,
    globalVolume: 1.0,
    quality: 'standard',
    ffmpegProcess: null,
    streamLoop: null,        // Pacer interval
    streamQueue: [],         // JIT queue
    createdAt: Date.now(),
    autoDeleteTimer: null
  };
  
  rooms.set(roomCode, room);
  console.log('🏠 Room created:', roomCode, 'by', hostName);
  
  room.autoDeleteTimer = setTimeout(() => {
    deleteRoom(roomCode);
  }, AUTO_DELETE_TIMEOUT);
  
  broadcastRoomList();
  return room;
}

function deleteRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  console.log('🗑️ Deleting room:', roomCode);
  
  stopStream(roomCode);
  
  if (room.audioFile) {
    const filePath = join(UPLOAD_DIR, room.audioFile.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  
  if (room.autoDeleteTimer) {
    clearTimeout(room.autoDeleteTimer);
  }
  
  io.to(roomCode).emit('room-closed');
  
  rooms.delete(roomCode);
  broadcastRoomList();
}

function broadcastRoomList() {
  const roomList = Array.from(rooms.values()).map(room => ({
    roomId: room.code,
    hostName: room.hostName,
    listenerCount: room.listeners.size,
    playing: room.playing,
    hasFile: !!room.audioFile,
    metadata: room.metadata ? {
      title: room.metadata.title,
      artist: room.metadata.artist,
      duration: room.metadata.duration
    } : null
  }));
  
  io.emit('room-list', roomList);
}

// ═══════════════════════════════════════════════════════════
// METADATA
// ═══════════════════════════════════════════════════════════

function getMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      
      const audio = data.streams.find(s => s.codec_type === 'audio');
      const duration = parseFloat(data.format.duration) || 0;
      
      resolve({
        duration: duration * 1000,
        sampleRate: audio?.sample_rate || 44100,
        channels: audio?.channels || 2,
        title: data.format.tags?.title || 'Unknown Track',
        artist: data.format.tags?.artist || 'Unknown Artist'
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════
// ⚡ ULTRA-LOW LATENCY STREAMING ENGINE ⚡
// ═══════════════════════════════════════════════════════════

async function startStream(roomCode, seekMs = 0) {
  const room = rooms.get(roomCode);
  if (!room || !room.audioFile) return;

  console.log(`\n🎵 Starting ultra-low latency stream in room ${roomCode}`);
  stopStream(roomCode);

  const filePath = join(UPLOAD_DIR, room.audioFile.filename);
  if (!fs.existsSync(filePath)) return;

  if (!room.metadata) {
    room.metadata = await getMetadata(filePath);
  }

  room.duration = room.metadata.duration;

  // ⚡ OPTIMIZED SETTINGS: Quality-based but with low-latency focus
  const qualitySettings = {
    low: { sampleRate: 22050, channels: 1, chunkMs: 40 },      
    standard: { sampleRate: 44100, channels: 1, chunkMs: 40 }, 
    high: { sampleRate: 48000, channels: 1, chunkMs: 40 }      
  };

  const quality = qualitySettings[room.quality] || qualitySettings.standard;
  const SAMPLE_RATE = quality.sampleRate;
  const CHANNELS = quality.channels;
  const CHUNK_DURATION_MS = quality.chunkMs;
  const CHUNK_SIZE = Math.floor((SAMPLE_RATE * CHANNELS * 2 * CHUNK_DURATION_MS) / 1000);

  console.log(`   ⚙️  Quality: ${room.quality} @ ${SAMPLE_RATE}Hz`);
  console.log(`   📦 Chunk: ${CHUNK_DURATION_MS}ms (${CHUNK_SIZE} bytes)`);
  console.log(`   ⚡ Expected latency: 200-400ms`);

  room.playing = true;
  room.paused = false;
  room.startedAt = Date.now() - seekMs;
  room.streamQueue = [];

  // Send config immediately so clients prepare
  io.to(roomCode).emit('stream-config', { 
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    chunkDuration: CHUNK_DURATION_MS,
    quality: room.quality,
    action: 'start'
  });

  // ⚡ ULTRA-LOW LATENCY FFMPEG FLAGS
  const ffmpegCmd = ffmpeg(filePath)
    .seekInput(seekMs / 1000)
    .format('s16le')
    .audioCodec('pcm_s16le')
    .audioChannels(CHANNELS)
    .audioFrequency(SAMPLE_RATE)
    .audioFilters([`volume=${room.globalVolume}`])
    // CRITICAL LOW-LATENCY FLAGS
    .addOption('-tune', 'zerolatency')
    .addOption('-preset', 'ultrafast')
    .addOption('-fflags', '+nobuffer')
    .addOption('-probesize', '32')
    .addOption('-analyzeduration', '0');

  const ffmpegStream = ffmpegCmd.pipe();
  room.ffmpegProcess = ffmpegCmd;

  let buffer = Buffer.alloc(0);
  let chunkIndex = 0;
  let startTime = process.hrtime(); // High-precision timer
  let isBursting = true;
  const BURST_COUNT = 5; // Send first 5 chunks immediately (200ms buffer)

  // ⚡ REAL-TIME DATA PROCESSING
  ffmpegStream.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= CHUNK_SIZE) {
      const audioData = buffer.slice(0, CHUNK_SIZE);
      buffer = buffer.slice(CHUNK_SIZE);

      const packet = {
        data: audioData,
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        chunkDuration: CHUNK_DURATION_MS,
        index: chunkIndex++
      };

      if (isBursting && chunkIndex <= BURST_COUNT) {
        // BURST: Fill client buffer immediately
        io.to(roomCode).emit('audio-chunk', packet);
        if (chunkIndex === BURST_COUNT) {
          isBursting = false;
          console.log(`   💥 Burst complete: ${BURST_COUNT} chunks sent`);
        }
      } else {
        // QUEUE: Let pacer handle timing
        room.streamQueue.push(packet);
      }
    }
  });

  // ⚡ PRECISION PACER (Anti-Jitter Engine)
  const PACER_INTERVAL = 10; // Check every 10ms
  
  room.streamLoop = setInterval(() => {
    if (!room.playing) return;
    
    // Calculate how many chunks should have been sent by now
    const elapsedDiff = process.hrtime(startTime);
    const elapsedMs = (elapsedDiff[0] * 1000) + (elapsedDiff[1] / 1e6);
    const targetChunkIndex = Math.floor(elapsedMs / CHUNK_DURATION_MS);

    // Send all due chunks
    while (room.streamQueue.length > 0) {
      const nextPacket = room.streamQueue[0];
      
      // Allow small lookahead (1 chunk = 40ms)
      if (nextPacket.index <= targetChunkIndex + 1) { 
        io.to(roomCode).emit('audio-chunk', room.streamQueue.shift());
      } else {
        break; // Not time yet
      }
    }
  }, PACER_INTERVAL);

  ffmpegStream.on('end', () => {
    console.log('✅ Stream encoding complete');
    // Wait for queue to drain
    setTimeout(() => {
      stopStream(roomCode);
      room.playing = false;
      room.position = 0;
      broadcastRoomState(roomCode);
    }, (room.streamQueue.length * CHUNK_DURATION_MS) + 500);
  });

  ffmpegStream.on('error', (err) => {
    if (!err.message.includes('SIGKILL')) {
      console.error('❌ Stream error:', err.message);
    }
    stopStream(roomCode);
  });

  broadcastRoomState(roomCode);
  console.log(`✅ Ultra-low latency streaming active`);
}

function stopStream(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  if (room.streamLoop) {
    clearInterval(room.streamLoop);
    room.streamLoop = null;
  }

  if (room.ffmpegProcess) {
    try {
      room.ffmpegProcess.kill('SIGKILL'); // Fast kill
    } catch (e) {}
    room.ffmpegProcess = null;
  }

  room.playing = false;
  room.streamQueue = [];
  broadcastRoomState(roomCode);
}

function pauseStream(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !room.playing) return;

  const elapsed = Date.now() - room.startedAt;
  room.position = elapsed;
  
  stopStream(roomCode);
  room.paused = true;
  
  broadcastRoomState(roomCode);
}

function resumeStream(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !room.paused) return;
  
  startStream(roomCode, room.position);
}

function seekStream(roomCode, position) {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  const wasPlaying = room.playing;
  stopStream(roomCode);
  room.position = position;
  
  if (wasPlaying) {
    startStream(roomCode, position);
  } else {
    room.paused = true;
    broadcastRoomState(roomCode);
  }
}

function setGlobalVolume(roomCode, volume) {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  room.globalVolume = Math.max(0, Math.min(1, volume));
  
  if (room.playing) {
    const currentPos = Date.now() - room.startedAt;
    startStream(roomCode, currentPos);
  }
  
  broadcastRoomState(roomCode);
}

function setQuality(roomCode, quality) {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  room.quality = quality;
  
  if (room.playing) {
    const currentPos = Date.now() - room.startedAt;
    startStream(roomCode, currentPos);
  }
  
  broadcastRoomState(roomCode);
}

// ═══════════════════════════════════════════════════════════
// BROADCAST
// ═══════════════════════════════════════════════════════════

function broadcastRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const state = {
    playing: room.playing,
    paused: room.paused,
    position: room.playing ? Date.now() - room.startedAt : room.position,
    duration: room.duration,
    globalVolume: room.globalVolume,
    quality: room.quality,
    metadata: room.metadata
  };

  io.to(roomCode).emit('room-state', state);
}

function broadcastListenerList(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const listeners = Array.from(room.listeners.values()).map(l => ({
    id: l.id,
    name: l.name,
    volume: l.volume,
    muted: l.muted,
    ping: l.ping
  }));

  io.to(roomCode).emit('listener-list', listeners);
}

// ═══════════════════════════════════════════════════════════
// SOCKET.IO
// ═══════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  console.log('🔌 Connected:', socket.id);

  socket.on('get-rooms', (callback) => {
    const roomList = Array.from(rooms.values()).map(room => ({
      roomId: room.code,
      hostName: room.hostName,
      listenerCount: room.listeners.size,
      playing: room.playing,
      hasFile: !!room.audioFile,
      metadata: room.metadata ? {
        title: room.metadata.title,
        artist: room.metadata.artist
      } : null
    }));
    
    callback(roomList);
  });

  socket.on('create-room', ({ hostName }, callback) => {
    const room = createRoom(socket.id, hostName);
    socket.join(room.code);
    
    callback({ 
      success: true, 
      roomCode: room.code,
      hostName: room.hostName
    });
  });

  socket.on('join-as-host', ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);
    
    if (!room) {
      callback({ error: 'Room not found' });
      return;
    }

    room.hostSocketId = socket.id;
    socket.join(roomCode);
    
    callback({
      success: true,
      roomState: {
        playing: room.playing,
        paused: room.paused,
        position: room.position,
        duration: room.duration,
        metadata: room.metadata,
        quality: room.quality,
        hasFile: !!room.audioFile
      }
    });

    console.log('👑 Host joined room:', roomCode);
    setTimeout(() => broadcastListenerList(roomCode), 100);
  });

  socket.on('join-as-listener', ({ roomCode, listenerName }, callback) => {
    const room = rooms.get(roomCode);
    
    if (!room) {
      callback({ error: 'Room not found' });
      return;
    }

    socket.join(roomCode);
    
    const listener = {
      id: socket.id,
      name: listenerName || `Listener ${room.listeners.size + 1}`,
      volume: 1.0,
      muted: false,
      ping: 0,
      joinedAt: Date.now()
    };

    room.listeners.set(socket.id, listener);

    callback({
      success: true,
      roomCode,
      hostName: room.hostName,
      currentState: {
        playing: room.playing,
        paused: room.paused,
        position: room.playing ? Date.now() - room.startedAt : room.position,
        duration: room.duration,
        metadata: room.metadata,
        quality: room.quality
      }
    });

    broadcastListenerList(roomCode);
    console.log(`👂 ${listener.name} joined room ${roomCode}`);
  });

  socket.on('play', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostSocketId) return;
    
    if (room.paused) {
      resumeStream(roomCode);
    } else {
      startStream(roomCode, 0);
    }
  });

  socket.on('pause', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostSocketId) return;
    pauseStream(roomCode);
  });

  socket.on('stop', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostSocketId) return;
    stopStream(roomCode);
    room.position = 0;
    broadcastRoomState(roomCode);
  });

  socket.on('seek', ({ roomCode, position }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostSocketId) return;
    seekStream(roomCode, position);
  });

  socket.on('set-global-volume', ({ roomCode, volume }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostSocketId) return;
    setGlobalVolume(roomCode, volume);
  });

  socket.on('set-listener-volume', ({ roomCode, listenerId, volume }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostSocketId) return;
    
    const listener = room.listeners.get(listenerId);
    if (listener) {
      listener.volume = volume;
      io.to(listenerId).emit('volume-update', { volume });
      broadcastListenerList(roomCode);
    }
  });

  socket.on('mute-listener', ({ roomCode, listenerId, muted }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostSocketId) return;
    
    const listener = room.listeners.get(listenerId);
    if (listener) {
      listener.muted = muted;
      io.to(listenerId).emit('mute-update', { muted });
      broadcastListenerList(roomCode);
    }
  });

  socket.on('set-quality', ({ roomCode, quality }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostSocketId) return;
    setQuality(roomCode, quality);
  });

  socket.on('update-ping', ({ roomCode, ping }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const listener = room.listeners.get(socket.id);
    if (listener) {
      listener.ping = ping;
      broadcastListenerList(roomCode);
    }
  });

  socket.on('ping-request', () => {
    socket.emit('pong-response');
  });

  socket.on('disconnect', () => {
    console.log('🔌 Disconnected:', socket.id);

    for (const [roomCode, room] of rooms) {
      if (room.hostSocketId === socket.id) {
        setTimeout(() => {
          const currentRoom = rooms.get(roomCode);
          if (currentRoom && currentRoom.hostSocketId === socket.id) {
            deleteRoom(roomCode);
          }
        }, 30000);
      }
      
      if (room.listeners.has(socket.id)) {
        room.listeners.delete(socket.id);
        broadcastListenerList(roomCode);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════
// UPLOAD
// ═══════════════════════════════════════════════════════════

app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    const roomCode = req.body.roomCode;
    const room = rooms.get(roomCode);
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (room.audioFile) {
      const oldPath = join(UPLOAD_DIR, room.audioFile.filename);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    room.audioFile = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size
    };

    room.metadata = await getMetadata(req.file.path);
    
    console.log(`📁 File uploaded to room ${roomCode}:`, req.file.originalname);

    res.json({ 
      success: true,
      metadata: room.metadata
    });

    broadcastRoomState(roomCode);
    broadcastRoomList();

  } catch (err) {
    console.error('❌ Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════

const PORT = 3000;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('\n🚀 ════════════════════════════════════════');
  console.log('   ULTRA-LOW LATENCY AUDIO SERVER');
  console.log('   ════════════════════════════════════════');
  console.log(`   🌐 http://localhost:${PORT}`);
  console.log('   ⚡ 40ms chunks (ultra-responsive)');
  console.log('   💥 Burst buffering (instant start)');
  console.log('   🎯 Precision pacer (no jitter)');
  console.log('   📊 Expected latency: 200-400ms');
  console.log('════════════════════════════════════════\n');
});

process.on('SIGINT', () => {
  console.log('\n⏹️ Shutting down...');
  for (const roomCode of rooms.keys()) {
    deleteRoom(roomCode);
  }
  process.exit(0);
});
