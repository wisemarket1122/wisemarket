import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import http from "http";
import { Server } from "socket.io";
import db from "./config/db.js";

import authRouter from "./routes/auth.js";
import marketRouter from "./routes/market.js";
import communityRouter from "./routes/community.js";
import chatRouter from "./routes/chat.js";
import mypageRouter from "./routes/mypage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const io = new Server(server);

// 뷰 엔진 설정
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// 정적 파일 폴더
app.use(express.static(path.join(__dirname, "public")));

// 폼 데이터 / JSON 파싱
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 세션 설정
app.use(
  session({
    secret: "campus-market-secret",
    resave: false,
    saveUninitialized: false,
  })
);

// 모든 뷰에서 현재 로그인 유저 사용 가능하게
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// 라우터 연결
app.use("/auth", authRouter);
app.use("/market", marketRouter);
app.use("/community", communityRouter);
app.use("/chat", chatRouter);
app.use("/mypage", mypageRouter);

io.on("connection", (socket) => {
  console.log("🔌 소켓 연결됨:", socket.id);

  // 방 입장
  socket.on("joinRoom", ({ roomId, userId, nickname }) => {
    console.log("📥 joinRoom 이벤트 도착:", { roomId, userId, nickname });

    if (!roomId) return;

    socket.join(String(roomId));
    socket.data.userId = userId;
    socket.data.nickname = nickname;

    console.log(`✅ 사용자 ${nickname}가 방 ${roomId} 입장`);
  });

  // 메시지 전송
  socket.on("chatMessage", async ({ roomId, message }) => {
    console.log("📥 chatMessage 이벤트 도착:", { roomId, message });

    try {
      if (!roomId || !message) {
        console.log("⚠️ roomId 또는 message 없음, 무시");
        return;
      }

      const userId = socket.data.userId;
      const nickname = socket.data.nickname;
      console.log("socket.data:", socket.data);

      if (!userId) {
        console.log("⚠️ userId 없음, 저장/전송 안 함");
        return;
      }

      // DB 저장
      await db.query(
        "INSERT INTO chat_messages (room_id, sender_id, content) VALUES (?, ?, ?)",
        [roomId, userId, message]
      );
      console.log("💾 DB에 chat_messages 삽입 완료");

      // 같은 방 사람들한테 뿌리기
      io.to(String(roomId)).emit("chatMessage", {
        roomId,
        message,
        userId,
        nickname,
        created_at: new Date().toISOString(),
      });
      console.log("📤 방으로 chatMessage 브로드캐스트 완료:", roomId);
    } catch (err) {
      console.error("❌ 실시간 메시지 저장/전송 오류:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔌 소켓 연결 종료:", socket.id);
  });
});



// 홈 라우트
app.get("/", async (req, res) => {
  try {
    const [items] = await db.query(
      `
      SELECT
        m.*,
        u.nickname AS seller_nickname,
        (
          SELECT image_path
          FROM market_item_images i
          WHERE i.item_id = m.item_id
          ORDER BY i.image_id ASC
          LIMIT 1
        ) AS thumbnail
      FROM market_items m
      JOIN users u ON m.seller_id = u.user_id
      ORDER BY m.created_at DESC
      LIMIT 8
      `
    );

    res.render("index", {
      title: "WISE market",
      items,
      currentUser: req.session.user || null,
    });
  } catch (err) {
    console.error("홈 화면 오류:", err);
    res.render("index", {
      title: "WISE market",
      items: [],
      currentUser: req.session.user || null,
    });
  }
});

// 디버그: 프로세스가 왜 종료되는지 보기
process.on("exit", (code) => {
  console.log("프로세스가 종료됩니다. 코드:", code);
});

process.on("uncaughtException", (err) => {
  console.error("잡히지 않은 예외 발생:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("처리되지 않은 Promise 오류:", reason);
});

// 서버 실행
server.listen(PORT, HOST, () => {
  console.log(`서버 실행: http://localhost:${PORT}`);
  console.log(`같은 와이파이에서 접속: http://10.9.3.92:${PORT}`);
});
