import express from "express";
import db from "../config/db.js";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = express.Router();

/* =========================================
   업로드 설정: public/uploads/market
   브라우저에서는 /uploads/market/파일명
   ========================================= */

const uploadDir = "public/uploads/market";

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  },
});

const upload = multer({ storage });

/* =========================================
   로그인 여부 체크
   ========================================= */

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/auth/login");
  }
  next();
}

/* =========================================
   GET /market
   - 장터 목록
   - 검색 (q)
   - 페이지네이션 (page, 12개씩)
   ========================================= */

router.get("/", async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = 12;
  const offset = (page - 1) * limit;
  const q = (req.query.q || "").trim();
  const category = (req.query.category || "").trim();

  try {
    let where = "1=1";
    const params = [];

    if (q) {
      where += " AND (m.title LIKE ? OR m.description LIKE ?)";
      params.push(`%${q}%`, `%${q}%`);
    }

    if (category) {
      where += " AND m.category = ?";
      params.push(category);
    }

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
      WHERE ${where}
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    const [countRows] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM market_items m
      WHERE ${where}
      `,
      params
    );

    const totalItems = countRows[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    res.render("market/list", {
      title: "캠퍼스 장터",
      items,
      q,
      page,
      category,
      totalPages,
      totalItems,
      limit,
      currentUser: req.session.user || null,
    });
  } catch (err) {
    console.error("상품 목록 조회 오류:", err);
    res.status(500).send("상품 목록을 불러오는 중 오류가 발생했습니다.");
  }
});

/* =========================================
   GET /market/new
   - 상품 등록 화면
   ========================================= */

router.get("/new", requireLogin, (req, res) => {
  res.render("market/new", {
    title: "상품 등록",
    error: null,
    currentUser: req.session.user || null,
  });
});

/* =========================================
   POST /market/new
   - 상품 등록 처리
   - 이미지 여러 장 업로드 (name="images")
   - status는 INSERT에서 빼고, DB 기본값 '판매중' 사용
   ========================================= */

router.post(
  "/new",
  requireLogin,
  upload.array("images", 5), // input name="images"
  async (req, res) => {
    const { title, description, price, category } = req.body;
    const sellerId = req.session.user.user_id;

    if (!title || !description || !price) {
      return res.render("market/new", {
        title: "상품 등록",
        error: "제목, 설명, 가격은 필수입니다.",
        currentUser: req.session.user || null,
      });
    }

    try {
      // 1) 상품 정보 저장 (status 컬럼은 제외 → DB default '판매중' 사용)
      const [result] = await db.query(
        `
        INSERT INTO market_items
          (title, description, price, category, seller_id)
        VALUES (?, ?, ?, ?, ?)
        `,
        [title, description, price, category || null, sellerId]
      );

      const itemId = result.insertId;

      // 2) 이미지 정보 저장
      if (req.files && req.files.length > 0) {
        const imageInserts = req.files.map((file) => [
          itemId,
          "/uploads/market/" + file.filename,
        ]);

        await db.query(
          `
          INSERT INTO market_item_images (item_id, image_path)
          VALUES ?
          `,
          [imageInserts]
        );
      }

      // 3) 상세 페이지로 이동
      return res.redirect("/market/" + itemId);
    } catch (err) {
      console.error("상품 등록 오류:", err);
      return res
        .status(500)
        .send("상품을 등록하는 중 오류가 발생했습니다.");
    }
  }
);

/* =========================================
   GET /market/:itemId
   - 상품 상세 보기 + 이미지 목록
   ========================================= */

router.get("/:itemId", async (req, res) => {
  const itemId = req.params.itemId;

  try {
    const [[item]] = await db.query(
      `
      SELECT
        m.*,
        u.nickname AS seller_nickname
      FROM market_items m
      JOIN users u ON m.seller_id = u.user_id
      WHERE m.item_id = ?
      `,
      [itemId]
    );

    if (!item) {
      return res.status(404).send("해당 상품을 찾을 수 없습니다.");
    }

    const [images] = await db.query(
      `
      SELECT *
      FROM market_item_images
      WHERE item_id = ?
      ORDER BY image_id ASC
      `,
      [itemId]
    );

    res.render("market/detail", {
      title: item.title,
      item,
      images,
      currentUser: req.session.user || null,
    });
  } catch (err) {
    console.error("상품 상세 조회 오류:", err);
    res.status(500).send("상품을 불러오는 중 오류가 발생했습니다.");
  }
});

/* =========================================
   POST /market/:itemId/status
   - 판매 상태 변경 (판매중 / 예약중 / 판매완료)
   ========================================= */

router.post("/:itemId/status", requireLogin, async (req, res) => {
  const itemId = req.params.itemId;
  const { status } = req.body;
  const userId = req.session.user.user_id;

  if (!["판매중", "예약중", "판매완료"].includes(status)) {
    return res.status(400).send("잘못된 상태 값입니다.");
  }

  try {
    const [[item]] = await db.query(
      "SELECT * FROM market_items WHERE item_id = ?",
      [itemId]
    );

    if (!item) {
      return res.status(404).send("해당 상품을 찾을 수 없습니다.");
    }

    if (item.seller_id !== userId) {
      return res.status(403).send("상태를 변경할 권한이 없습니다.");
    }

    await db.query(
      "UPDATE market_items SET status = ? WHERE item_id = ?",
      [status, itemId]
    );

    return res.redirect("/market/" + itemId);
  } catch (err) {
    console.error("판매 상태 변경 오류:", err);
    return res
      .status(500)
      .send("상태를 변경하는 중 오류가 발생했습니다.");
  }
});

/* =========================================
   POST /market/:itemId/delete
   - 상품 삭제
   ========================================= */

router.post("/:itemId/delete", requireLogin, async (req, res) => {
  const itemId = req.params.itemId;
  const userId = req.session.user.user_id;

  try {
    const [[item]] = await db.query(
      "SELECT * FROM market_items WHERE item_id = ?",
      [itemId]
    );

    if (!item) {
      return res.status(404).send("해당 상품을 찾을 수 없습니다.");
    }

    if (item.seller_id !== userId) {
      return res.status(403).send("삭제 권한이 없습니다.");
    }

    // 채팅 → 채팅방 → 이미지 → 상품 순서로 삭제
    await db.query(
      "DELETE FROM chat_messages WHERE room_id IN (SELECT room_id FROM chat_rooms WHERE item_id = ?)",
      [itemId]
    );
    await db.query("DELETE FROM chat_rooms WHERE item_id = ?", [itemId]);
    await db.query("DELETE FROM market_item_images WHERE item_id = ?", [
      itemId,
    ]);
    await db.query("DELETE FROM market_items WHERE item_id = ?", [itemId]);

    return res.redirect("/market");
  } catch (err) {
    console.error("상품 삭제 오류:", err);
    return res.status(500).send("상품을 삭제하는 중 오류가 발생했습니다.");
  }
});

export default router;
