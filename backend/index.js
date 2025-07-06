import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import axios from "axios";
import { fileURLToPath } from "url";
import { dirname } from "path";

// ✅ Get __dirname in ES Module environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);

// ✅ Pinger to keep server active (optional)
if (process.env.NODE_ENV !== "production") {
  const url = "http://localhost:5000";
  const interval = 30000;

  function reloadWebsite() {
    axios
      .get(url)
      .catch((error) => {
        console.error(`Pinger error: ${error.message}`);
      });
  }

  setInterval(reloadWebsite, interval);
}

// ✅ Setup Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const rooms = new Map();

// ✅ Socket.io logic
io.on("connection", (socket) => {
  console.log("User Connected", socket.id);

  let currentRoom = null;
  let currentUser = null;

  socket.on("join", ({ roomId, userName }) => {
    if (currentRoom) {
      socket.leave(currentRoom);
      rooms.get(currentRoom)?.users.delete(currentUser);
      io.to(currentRoom).emit("userJoined", Array.from(rooms.get(currentRoom).users || []));
    }

    currentRoom = roomId;
    currentUser = userName;

    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, { users: new Set(), code: "// start code here" });
    }

    rooms.get(roomId).users.add(userName);
    socket.emit("codeUpdate", rooms.get(roomId).code);
    io.to(roomId).emit("userJoined", Array.from(rooms.get(currentRoom).users));
  });

  socket.on("codeChange", ({ roomId, code }) => {
    if (rooms.has(roomId)){
      rooms.get(roomId).code = code;
    }
    socket.to(roomId).emit("codeUpdate", code);
  });

  socket.on("leaveRoom", () => {
    if (currentRoom && currentUser && rooms.has(currentRoom)) {
      rooms.get(currentRoom).users.delete(currentUser);
      io.to(currentRoom).emit("userJoined", Array.from(rooms.get(currentRoom).users));
      socket.leave(currentRoom);
    }
    currentRoom = null;
    currentUser = null;
  });

  socket.on("typing", ({ roomId, userName }) => {
    socket.to(roomId).emit("userTyping", userName);
  });

  socket.on("languageChange", ({ roomId, language }) => {
    io.to(roomId).emit("languageUpdate", language);
  });

  socket.on("compileCode", async ({ code, roomId, language, version,input }) => {
    if (rooms.has(roomId)) {
      try {
        const response = await axios.post("https://emkc.org/api/v2/piston/execute", {
          language,
          version,
          files: [{ content: code }],
          stdin: input,
        });
        io.to(roomId).emit("codeResponse", response.data);
      } catch (err) {
        console.error("Compile error:", err.message);
        io.to(roomId).emit("codeResponse", { run: { output: "Compilation failed." } });
      }
    }
  });

  socket.on("disconnect", () => {
    if (currentRoom && currentUser && rooms.has(currentRoom)) {
      rooms.get(currentRoom).users.delete(currentUser);
      io.to(currentRoom).emit("userJoined", Array.from(rooms.get(currentRoom).users));
    }
    console.log("User Disconnected");
  });
});

// ✅ Serve frontend static files
const port = process.env.PORT || 5000;
const frontendPath = path.join(__dirname, "../frontend/dist");

app.use(express.static(frontendPath));

// ✅ Safer wildcard route for SPA (fixes path-to-regexp error)
app.get(/^\/(?!socket.io).*/, (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

// ✅ Start server
server.listen(port, () => {
  console.log(`Server is working on port ${port}`);
});
