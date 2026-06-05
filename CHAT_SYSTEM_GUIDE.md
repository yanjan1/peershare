# P2P Chat System - Implementation Guide

## 🎯 Overview

This document outlines the complete architecture for extending PeerShare into a full-scale **peer-to-peer chat system** with user authentication, friends list, real-time messaging, and local chat history caching.

### Core Features

✅ **User Authentication** - Sign up, login, JWT tokens  
✅ **Friends System** - Request/accept/reject flow  
✅ **Global User Search** - Find users by username  
✅ **Real-time Chat** - P2P messaging via WebSocket (Socket.IO)  
✅ **Chat History** - Locally cached conversations (IndexedDB)  
✅ **Typing Indicators** - Real-time "user is typing" status  
✅ **Read Receipts** - Message delivery & read status  
✅ **Offline Support** - Messages queued when offline  
✅ **File Transfer** - WebRTC DataChannel integration  
✅ **Disconnection Alerts** - Peer status notifications  

---

## 📁 File Structure

```
server/
├── src/
│   ├── index.js                 # Socket.IO server & signaling
│   ├── auth.js                  # Password hashing, JWT tokens
│   ├── db.js                    # SQLite database & schema
│   └── routes/
│       ├── auth.js              # Signup, login, profile
│       ├── users.js             # User search & status
│       ├── friends.js           # Friend requests & list
│       └── messages.js          # NEW - Chat messaging
│
ui/
├── src/
│   ├── storage/
│   │   ├── localStorageManager.js    # NEW - Token & metadata cache
│   │   └── indexeddbManager.js       # NEW - Chat history cache
│   │
│   └── utils/
│       ├── apiClient.js              # NEW - REST API calls
│       └── socketManager.js           # NEW - WebSocket events
```

---

## 🗄️ Database Schema

### New Tables Added

#### `messages` - Chat message history
```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',        -- 'text', 'file', 'system'
  file_metadata TEXT,                      -- JSON metadata for files
  is_read BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (from_user_id) REFERENCES users(id),
  FOREIGN KEY (to_user_id) REFERENCES users(id)
)
```

#### `chat_sessions` - Track active conversations
```sql
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  user_id_1 TEXT NOT NULL,
  user_id_2 TEXT NOT NULL,
  last_message_id TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id_1) REFERENCES users(id),
  FOREIGN KEY (user_id_2) REFERENCES users(id),
  UNIQUE(user_id_1, user_id_2)
)
```

---

## 🔌 Server-Side API Endpoints

### Messages Routes (`/api/messages`)

#### `POST /send`
Send a message (stored in DB if recipient offline)
```javascript
{
  to_user_id: "user-123",
  content: "Hello!",
  message_type: "text",
  file_metadata: null
}
```

#### `GET /conversation/:userId`
Retrieve chat history with a user
```
GET /messages/conversation/user-123?limit=50&offset=0
```

#### `POST /:messageId/read`
Mark message as read
```javascript
POST /messages/msg-456/read
```

#### `POST /sync`
Sync unread messages & chat sessions (offline support)
```javascript
POST /messages/sync
// Returns: { unreadMessages, chatSessions, syncTime }
```

#### `GET /unread-count`
Get number of unread messages
```
GET /messages/unread-count
// Returns: { unreadCount: 5 }
```

#### `DELETE /:messageId`
Delete a message (sender only)
```
DELETE /messages/msg-456
```

---

## 🔌 Socket.IO Events

### Real-Time Communication

**Client → Server:**
- `auth(token)` - Authenticate user
- `chat_message({ toUserId, content, messageType, messageId })` - Send message
- `typing({ toUserId, isTyping })` - Typing indicator
- `message_read({ toUserId, messageId })` - Mark as read
- `signal({ toUserId, payload, code })` - WebRTC signaling
- `transfer_start({ toUserId, code, fileName, fileSize })` - File transfer start
- `transfer_progress({ toUserId, code, percent, bytes })` - Upload progress
- `transfer_complete({ toUserId, code, fileName })` - Transfer done
- `transfer_error({ toUserId, code, error })` - Transfer failed
- `chat_connected({ withUserId })` - Peer online
- `chat_disconnecting({ withUserId })` - Peer leaving

**Server → Client:**
- `user_online({ userId, username, status })` - User came online
- `user_offline({ userId, status })` - User went offline
- `online_users({ users })` - List of online users
- `chat_message(message)` - Receive message
- `message_sent({ messageId, delivered, deliveredAt })` - Message sent confirmation
- `user_typing({ fromUserId, isTyping })` - Peer is typing
- `message_read_receipt({ fromUserId, messageId, readAt })` - Message read
- `signal(signalData)` - WebRTC signal
- `chat_peer_online({ userId, username })` - Peer connected
- `chat_peer_offline({ userId, username })` - Peer disconnected

---

## 💾 Client-Side Storage

### LocalStorage Manager
Used for small, frequently-accessed data:
```javascript
const storage = require('./storage/localStorageManager');

storage.saveToken(token);                    // Save JWT token
storage.getToken();                          // Get JWT token
storage.saveCurrentUser(user);               // Save logged-in user
storage.saveFriends(friendsList);            // Save friends list
storage.getPendingMessages();                // Get unsent messages
```

### IndexedDB Manager
Used for large chat history data:
```javascript
const db = require('./storage/indexeddbManager');

await db.init();                             // Initialize DB
await db.saveMessage(message);               // Save one message
await db.saveMessages(messages);             // Save batch
await db.getMessages(conversationId, 50);    // Get conversation
await db.saveDraft(conversationId, text);    // Save draft
await db.getDraft(conversationId);           // Restore draft
```

---

## 🌐 API Client

Centralized REST API calls:
```javascript
const api = require('./utils/apiClient');

// Auth
await api.signup(username, email, password);
await api.login(username, password);
await api.getMe();

// Users
await api.searchUsers('john');
await api.getUser(userId);

// Friends
await api.sendFriendRequest(userId);
await api.acceptFriendRequest(requestId);
await api.getFriends();

// Messages
await api.sendMessage(toUserId, content);
await api.getConversation(userId, limit=50);
await api.markMessageAsRead(messageId);
await api.syncMessages();                    // Offline sync
await api.getUnreadCount();
```

---

## 📡 Socket Manager

Real-time event handling:
```javascript
const socket = require('./utils/socketManager');

// Connect
await socket.connect(token);

// Listen for events
socket.on('chat_message', (message) => { /* handle */ });
socket.on('user_typing', (data) => { /* handle */ });
socket.on('user_online', (user) => { /* handle */ });

// Send events
socket.sendMessage(toUserId, content, messageId);
socket.sendTypingIndicator(toUserId, true);
socket.markMessageAsRead(toUserId, messageId);
```

---

## 🔄 Message Flow

### Sending a Message

```
User types message → Click send
    ↓
1. Generate unique messageId (client)
2. Save to IndexedDB (local cache)
3. Send via Socket.IO (real-time to peer)
4. Also POST to /api/messages/send (persist on server)
5. If peer online: message_sent event with delivered: true
6. If peer offline: stored in DB, synced when they reconnect
```

### Receiving a Message

```
Server receives via Socket.IO
    ↓
1. Emit 'chat_message' event to recipient (if online)
2. Store in SQLite DB (permanent)
3. Mark is_read: false
4. On reconnect: /api/messages/sync fetches all unread
5. IndexedDB caches locally
6. UI updates with new message
```

### Chat History Sync (Offline)

```
User comes online
    ↓
1. Call POST /api/messages/sync
2. Server returns { unreadMessages, chatSessions }
3. Client loads from IndexedDB or fetches from /messages/conversation/:userId
4. Merge with local cache
5. Any pending messages queued during offline are sent
6. UI renders complete conversation
```

---

## 🎨 Recommended UI Components

### Chat Window
```
┌─────────────────────────────────┐
│ Friend Name        [info] [call] │
├─────────────────────────────────┤
│                                 │
│  You: Hello! [12:30] ✓✓        │
│                                 │
│  Friend: Hi there! [12:31] ✓    │
│                                 │
│  Friend is typing...            │
│                                 │
├─────────────────────────────────┤
│ [📎] Type message...     [Send] │
└─────────────────────────────────┘
```

### Conversations List
```
┌──────────────────────────────┐
│ Search chats...              │
├──────────────────────────────┤
│ John (2 unread)              │
│ Last: "See you later" [12:45]│
│                              │
│ Sarah (online) 🟢            │
│ Last: "That's awesome!"      │
│                              │
│ Mike (offline)               │
│ Last: "Thanks!" [Yesterday]  │
└──────────────────────────────┘
```

---

## 🚀 Integration Checklist

### Frontend Setup

- [ ] Install `socket.io-client`
- [ ] Create `ui/src/.env` with API URLs:
  ```
  REACT_APP_API_URL=http://localhost:3000/api
  REACT_APP_SOCKET_URL=http://localhost:3000
  ```
- [ ] Initialize storage managers in app startup
- [ ] Connect socket on user login
- [ ] Sync messages on reconnect
- [ ] Queue messages when offline
- [ ] Display typing indicators
- [ ] Show read receipts
- [ ] Cache conversation history

### Backend Setup

- [ ] Run migrations to create `messages` & `chat_sessions` tables
- [ ] Verify `socket.io` & `sqlite3` installed
- [ ] Test all message API endpoints
- [ ] Verify Socket.IO events fire correctly
- [ ] Test offline message persistence
- [ ] Test multi-device support (multiple connections per user)
- [ ] Add rate limiting to prevent spam
- [ ] Consider message encryption (future)

---

## 🔐 Security Considerations

1. **Authentication**: JWT tokens (7 day expiry)
2. **Authorization**: Only friends can message each other
3. **Message Access**: Users can only access their own messages
4. **Password**: PBKDF2 with 100k iterations + random salt
5. **Future**: End-to-end encryption, message signing

---

## 📊 Sample Data Flow

### Authentication Flow
```
1. User submits signup form
2. POST /api/auth/signup { username, email, password }
3. Server hashes password, creates user, issues JWT
4. Client saves token to localStorage
5. Client connects Socket.IO with token
6. Server validates token, marks user online
```

### Friend Request Flow
```
1. User searches: GET /api/users/search?q=john
2. User sends friend request: POST /api/friends/request { to_user_id }
3. Recipient sees request: GET /api/friends/requests
4. Recipient accepts: POST /api/friends/request/:id/accept
5. Both can now message each other
```

### Chat Message Flow
```
1. User types message, presses send
2. Client generates messageId, saves to IndexedDB
3. Socket.IO: emit 'chat_message' to peer
4. Server: forwards to recipient if online
5. Server: also stores in DB
6. Recipient receives via Socket.IO (real-time)
7. Recipient confirms read: POST /api/messages/:id/read
8. Both caches sync on next activity
```

---

## 🧪 Testing Endpoints

```bash
# Signup
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","email":"alice@test.com","password":"123456"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"123456"}'

# Search users
curl -X GET "http://localhost:3000/api/users/search?q=bob" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Send message
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"to_user_id":"user-123","content":"Hello!"}'

# Get conversation
curl -X GET http://localhost:3000/api/messages/conversation/user-123 \
  -H "Authorization: Bearer YOUR_TOKEN"

# Sync offline messages
curl -X POST http://localhost:3000/api/messages/sync \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 📝 Next Steps

1. **Build Chat UI** - Create message list, input, typing indicator components
2. **Implement Offline Queue** - Persist pending messages in IndexedDB
3. **Add File Sharing** - Integrate WebRTC DataChannel with chat
4. **Message Encryption** - Implement E2E encryption (TweetNaCl.js)
5. **UI Refinements** - Animations, notifications, mobile responsive
6. **Performance** - Message pagination, lazy loading
7. **Testing** - Unit tests, integration tests
8. **Deployment** - Docker, CI/CD, monitoring

---

## 💡 Tips

- **Offline First**: Always save to local storage before sending
- **Real-time First**: Socket.IO for chat, REST for persistence
- **Battery Friendly**: Batch sync operations, debounce typing indicators
- **Privacy**: Messages stay local until synced, never transmitted cleartext
- **Scalability**: Consider message retention policies, archive old chats

---

## 🤝 Contributing

All the core infrastructure is ready. You can now:
- Build React/Vue components for the UI
- Add message encryption
- Implement voice/video calls
- Add group chats
- Build mobile apps (React Native)

Good luck! 🚀
