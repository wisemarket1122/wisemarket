import express from "express";
import db from "../config/db.js";

const router = express.Router();

// 로그인 체크 미들웨어
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/auth/login");
  }
  next();
}

// 채팅방 목록: 내가 buyer 이거나 seller 인 방들
router.get("/", requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;

  try {
    const [rooms] = await db.query(
      `SELECT r.*, 
              m.title AS item_title,
              buyer.nickname AS buyer_nickname,
              seller.nickname AS seller_nickname
       FROM chat_rooms r
       JOIN market_items m ON r.item_id = m.item_id
       JOIN users buyer ON r.buyer_id = buyer.user_id
       JOIN users seller ON r.seller_id = seller.user_id
       WHERE r.buyer_id = ? OR r.seller_id = ?
       ORDER BY r.created_at DESC`,
      [userId, userId]
    );

    res.render("chat/list", {
      title: "내 채팅방",
      rooms,
      currentUser: req.session.user,
    });
  } catch (err) {
    console.error("채팅방 목록 조회 오류:", err);
    res.status(500).send("채팅방 목록을 불러오는 중 오류가 발생했습니다.");
  }
});

// 채팅방 생성 또는 기존 방으로 이동
router.post("/room", requireLogin, async (req, res) => {
  const { item_id } = req.body;
  const userId = req.session.user.user_id;

  if (!item_id) {
    return res.redirect("/market");
  }

  try {
    // 상품 정보 조회
    const [[item]] = await db.query(
      "SELECT * FROM market_items WHERE item_id = ?",
      [item_id]
    );

    if (!item) {
      return res.status(404).send("해당 상품을 찾을 수 없습니다.");
    }

    const sellerId = item.seller_id;
    const buyerId = userId;

    // 자기 자신에게 채팅은 방지
    if (sellerId === buyerId) {
      return res.redirect("/market/" + item_id);
    }

    // 이미 존재하는 방이 있는지 확인
    const [existingRooms] = await db.query(
      `SELECT room_id FROM chat_rooms 
       WHERE item_id = ? AND buyer_id = ? AND seller_id = ?`,
      [item_id, buyerId, sellerId]
    );

    let roomId;

    if (existingRooms.length > 0) {
      roomId = existingRooms[0].room_id;
    } else {
      const [result] = await db.query(
        `INSERT INTO chat_rooms (item_id, buyer_id, seller_id) 
         VALUES (?, ?, ?)`,
        [item_id, buyerId, sellerId]
      );
      roomId = result.insertId;
    }

    res.redirect("/chat/" + roomId);
  } catch (err) {
    console.error("채팅방 생성 오류:", err);
    res.status(500).send("채팅방을 여는 중 오류가 발생했습니다.");
  }
});

// 채팅방 들어가기: 메시지 목록 보기
router.get("/:roomId", requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;
  const roomId = req.params.roomId;

  try {
    // 1) 채팅방 + 상품 + 참여자 닉네임
    const [[room]] = await db.query(
      `
      SELECT
        r.*,
        i.title AS item_title,
        seller.nickname AS seller_nickname,
        buyer.nickname AS buyer_nickname
      FROM chat_rooms r
      JOIN market_items i ON r.item_id = i.item_id
      JOIN users seller ON r.seller_id = seller.user_id
      JOIN users buyer ON r.buyer_id = buyer.user_id
      WHERE r.room_id = ?
      `,
      [roomId]
    );

    if (!room) {
      return res.status(404).send("채팅방을 찾을 수 없습니다.");
    }

    // 2) 메시지 + 보낸 사람 닉네임
    const [messages] = await db.query(
      `
      SELECT
        m.*,
        u.nickname AS sender_nickname
      FROM chat_messages m
      JOIN users u ON m.sender_id = u.user_id
      WHERE m.room_id = ?
      ORDER BY m.created_at ASC
      `,
      [roomId]
    );

    // 3) 상대방 닉네임
    const otherNickname =
      room.seller_id === userId ? room.buyer_nickname : room.seller_nickname;

    res.render("chat/room", {
      title: "채팅",
      room,
      messages,
      currentUser: req.session.user,
      otherNickname,
    });
  } catch (err) {
    console.error("채팅방 조회 오류:", err);
    res.status(500).send("채팅방을 불러오는 중 오류가 발생했습니다.");
  }
});


// 메시지 보내기
router.post("/:roomId/message", requireLogin, async (req, res) => {
  const roomId = req.params.roomId;
  const userId = req.session.user.user_id;
  const { content } = req.body;

  if (!content || content.trim() === "") {
    return res.redirect("/chat/" + roomId);
  }

  try {
    // 방 참여자인지 다시 한 번 체크
    const [[room]] = await db.query(
      "SELECT * FROM chat_rooms WHERE room_id = ?",
      [roomId]
    );

    if (!room) {
      return res.status(404).send("채팅방을 찾을 수 없습니다.");
    }

    if (room.buyer_id !== userId && room.seller_id !== userId) {
      return res.status(403).send("이 채팅방에 참여할 수 없습니다.");
    }

    await db.query(
      "INSERT INTO chat_messages (room_id, sender_id, content) VALUES (?, ?, ?)",
      [roomId, userId, content]
    );

    res.redirect("/chat/" + roomId);
  } catch (err) {
    console.error("메시지 전송 오류:", err);
    res.status(500).send("메시지를 전송하는 중 오류가 발생했습니다.");
  }
});

export default router;
