import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import db from "./config/db.js";

import authRouter from "./routes/auth.js";
import marketRouter from "./routes/market.js";
import communityRouter from "./routes/community.js";
import chatRouter from "./routes/chat.js";
import mypageRouter from "./routes/mypage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

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
app.listen(PORT, HOST, () => {
  console.log(`서버 실행: http://localhost:${PORT}`);
  console.log(`같은 와이파이에서 접속: http://10.9.3.92:${PORT}`);
});
